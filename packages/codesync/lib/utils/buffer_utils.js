'use babel';

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

import { isBinaryFileSync } from "isbinaryfile";
import { putLogEvent } from "../logger";
import { uploadFileToServer } from "./upload_file";
import { diff_match_patch } from "diff-match-patch";

import { CONFIG_PATH, DIFF_SIZE_LIMIT, REQUIRED_DIFF_KEYS, 
	REQUIRED_DIR_RENAME_DIFF_KEYS, REQUIRED_FILE_RENAME_DIFF_KEYS,
	SHADOW_REPO, ORIGINALS_REPO, DELETED_REPO } from "../constants";


export const isValidDiff = (diffData) => {
	const missingKeys = REQUIRED_DIFF_KEYS.filter(key => !(key in diffData));
	if (missingKeys.length) { return false; }
	const isRename = diffData.is_rename;
	const isDirRename = diffData.is_dir_rename;
	const diff = diffData.diff;
	if (diff && diff.length > DIFF_SIZE_LIMIT) { return false; }
	if (isRename || isDirRename) {
		if (!diff) { return false; }
		let diffJSON = {};
		try {
			diffJSON = yaml.load(diff);
		} catch (e) {
			return false;
		}
		if (isRename) {
			const missingRenameKeys = REQUIRED_FILE_RENAME_DIFF_KEYS.filter(key => !(key in diffJSON));
			if (missingRenameKeys.length) { return false; }
		}
		if (isDirRename) {
			const missingDirRenameKeys = REQUIRED_DIR_RENAME_DIFF_KEYS.filter(key => !(key in diffJSON));
			if (missingDirRenameKeys.length) { return false; }
		}
	}
	return true;
};

export const handleNewFileUpload = async (access_token, diffData, relPath, repoId, configJSON, diffFilePath) => {
	/* 
	Uplaods new file to server and adds it in config
	Ignore if file is not present in .originals repo 
	*/
	const originalsPath = path.join(ORIGINALS_REPO, `${diffData.repo_path}/${diffData.branch}/${relPath}`);
	if (!fs.existsSync(originalsPath)) { return; }
	const response = await uploadFileToServer(access_token, repoId, diffData.branch, originalsPath, relPath, diffData.created_at);
	if (response.error) { 
		putLogEvent(`Error uploading new file to server: ${response.error}`);
		return configJSON;
	}
	configJSON.repos[diffData.repo_path].branches[diffData.branch][relPath] = response.fileId;
	// write file id to config.yml
	fs.writeFileSync(CONFIG_PATH, yaml.safeDump(configJSON));
	fs.unlinkSync(diffFilePath);
	return configJSON;
};

export const handleFilesRename = (configJSON, repoPath, branch, relPath, oldFileId, oldRelPath) => {
	
	const oldShadowPath = path.join(SHADOW_REPO, `${repoPath}/${branch}/${oldRelPath}`);
	const newShadowPath = path.join(SHADOW_REPO, `${repoPath}/${branch}/${relPath}`);
	if (fs.existsSync(oldShadowPath)) { 
		fs.renameSync(oldShadowPath, newShadowPath);
	}
	configJSON.repos[repoPath].branches[branch][relPath] = oldFileId;
	// write file id to config.yml
	fs.writeFileSync(CONFIG_PATH, yaml.safeDump(configJSON));
};

export const isDirDeleted = (repoPath, branch, relPath) => {
	const shadowPath = path.join(SHADOW_REPO, `${repoPath}/${branch}/${relPath}`);
	return fs.existsSync(shadowPath) && fs.lstatSync(shadowPath).isDirectory;
};


export const cleanUpDeleteDiff = (repoPath, branch, relPath, configJSON) => {
	const shadowPath = path.join(SHADOW_REPO, `${repoPath}/${branch}/${relPath}`);
	const originalsPath = path.join(ORIGINALS_REPO, `${repoPath}/${branch}/${relPath}`);
	const cacheFilePath = path.join(DELETED_REPO, `${repoPath}/${branch}/${relPath}`);
	[shadowPath, originalsPath, cacheFilePath].forEach((path) => {
		if (fs.existsSync(path)) {
			fs.unlinkSync(path);
		}
	});
	delete configJSON.repos[repoPath].branches[branch][relPath];
	// write file id to config.yml
	fs.writeFileSync(CONFIG_PATH, yaml.safeDump(configJSON));
};

export const getDIffForDeletedFile = (repoPath, branch, relPath, configJSON) => {
	const shadowPath = path.join(SHADOW_REPO, `${repoPath}/${branch}/${relPath}`);
	let diff = "";
	if (!fs.existsSync(shadowPath)) {
		cleanUpDeleteDiff(repoPath, branch, relPath, configJSON);
		return diff;
	}
	// See if shadow file can be read
	const isBinary = isBinaryFileSync(shadowPath);
	if (isBinary) {
		cleanUpDeleteDiff(repoPath, branch, relPath, configJSON);
		return diff;
	}
	const shadowText = fs.readFileSync(shadowPath, "utf8");
	const dmp = new diff_match_patch();
	const patches = dmp.patch_make(shadowText, "");
	diff = dmp.patch_toText(patches);
	cleanUpDeleteDiff(repoPath, branch, relPath, configJSON);
	return diff;
};
