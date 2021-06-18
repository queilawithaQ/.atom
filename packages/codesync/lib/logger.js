'use babel';

import fs from 'fs';
import _ from 'lodash';
import yaml from 'js-yaml';
import AWS from 'aws-sdk';
import { AWS_REGION, CLIENT_LOGS_GROUP_NAME, DIFF_SOURCE, SEQUENCE_TOKEN_PATH, USER_PATH } from './constants';
import { readYML } from './utils/common';

let cloudwatchlogs = {};

export function putLogEvent(error, userEmail=null) {
	console.log(error);

	const users = readYML(USER_PATH);
	const sequenceTokenConfig = readYML(SEQUENCE_TOKEN_PATH);
	let accessKey = '';
	let secretKey = '';
	let sequenceToken = '';
	let email = '';

	if (userEmail && userEmail in users) {
		const user = users[userEmail];
		email = userEmail;
		accessKey = user.access_key;
		secretKey = user.secret_key;
		sequenceToken = sequenceTokenConfig[userEmail];
	} else {
		Object.keys(users).forEach(function (_email, index) {
			if (index === 0) {
				email = _email;
				const user = users[email];
				accessKey = user.access_key;
				secretKey = user.secret_key;
				sequenceToken = sequenceTokenConfig[email];	
			}
		});	
	}

	if (!(accessKey && secretKey && email)) {
		return;
	}

	if (_.isEmpty(cloudwatchlogs)) {
		cloudwatchlogs = new AWS.CloudWatchLogs({
			accessKeyId: accessKey,
			secretAccessKey: secretKey, 
			region: AWS_REGION
		});	
	}

	const logEvents = [ /* required */
		{
			message: JSON.stringify({
				msg: error,
				source: DIFF_SOURCE
			}), /* required */
			timestamp: new Date().getTime() /* required */
		}
	];
	const logGroupName = CLIENT_LOGS_GROUP_NAME;
	const logStreamName = email;

	const params = {
		logEvents,
		logGroupName,
		logStreamName,
	};

	if (sequenceToken) {
		params.sequenceToken = sequenceToken;
	}

	cloudwatchlogs.putLogEvents(params, function(err, data) {
		
		if (!err) { 
			// successful response
			sequenceTokenConfig[email] = data.nextSequenceToken;
			fs.writeFileSync(SEQUENCE_TOKEN_PATH, yaml.safeDump(sequenceTokenConfig));
			return;
		}
		// an error occurred
		/* 
		DataAlreadyAcceptedException: The given batch of log events has already been accepted.
		The next batch can be sent with sequenceToken: 49615429905286623782064446503967477603282951356289123634
		*/
		const errString = err.toString();
		if (errString.substr('DataAlreadyAcceptedException') || errString.substr('InvalidSequenceTokenException')) {
			const matches = errString.match(/(\d+)/);
			sequenceTokenConfig[email] = matches[0];
			fs.writeFileSync(SEQUENCE_TOKEN_PATH, yaml.safeDump(sequenceTokenConfig));
			putLogEvent(error, email);
		} else {
			console.log(err, err.stack);
		}
	});
}