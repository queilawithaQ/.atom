'use babel';

import fs from 'fs';
import yaml from 'js-yaml';
import walk from 'walk';
import path from 'path';
import dateFormat from "dateformat";

import {
    DIFFS_REPO,
    DIFF_SOURCE,
    DATETIME_FORMAT,
	SHADOW_REPO,
	DELETED_REPO
} from "../constants";


export function manageDiff(repoPath, branch, file_rel_path, diff, is_new_file=false, is_rename=false, is_deleted=false) {

	// Skip empty diffs
	if (!diff && !is_new_file && !is_deleted) {
		console.log(`Skipping: Empty diffs`);
		return;
	}

	const createdAt = dateFormat(new Date(), DATETIME_FORMAT);

	// Add new diff in the buffer
    const newDiff = {};
	newDiff.source = DIFF_SOURCE;
	newDiff.created_at = createdAt;
	newDiff.diff = diff;
	newDiff.repo_path = repoPath;
	newDiff.branch = branch;
	newDiff.file_relative_path = file_rel_path;
	
	if (is_new_file) {
		newDiff.is_new_file = true;
	}
	else if (is_rename) {
		newDiff.is_rename = true;
	}
	else if (is_deleted) {
		newDiff.is_deleted = true;
	}
	// Append new diff in the buffer
	fs.writeFileSync(`${DIFFS_REPO}/${new Date().getTime()}.yml`, yaml.safeDump(newDiff));
}

export const handleDirectoryRenameDiffs = async (repoPath, branch, diff) => {
	// For each nested file, create rename diff
	const diffJSON = JSON.parse(diff);
	const walker = walk.walk(diffJSON.new_path);
	walker.on("file", function (root, fileStats, next) {
		const newFilePath = `${root}/${fileStats.name}`;
		const oldFilePath = newFilePath.replace(diffJSON.new_path, diffJSON.old_path);
		const oldRelPath = oldFilePath.split(`${repoPath}/`)[1];
		const newRelPath = newFilePath.split(`${repoPath}/`)[1];
		const diff = JSON.stringify({
			'old_rel_path': oldRelPath,
			'new_rel_path': newRelPath,
			'old_abs_path': oldFilePath,
			'new_abs_path': newFilePath
		});
		manageDiff(repoPath, branch, newRelPath, diff, false, true);
		next();
	});
};

export const handleDirectoryDeleteDiffs = async (repoPath, branch, relPath) => {
	const shadowPath = path.join(SHADOW_REPO, `${repoPath}/${branch}/${relPath}`);

	const walker = walk.walk(shadowPath);
	walker.on("file", function (root, fileStats, next) {
		const filePath = `${root}/${fileStats.name}`;
		const relPath = filePath.split(`${repoPath}/${branch}/`)[1];
		const destDeleted = path.join(DELETED_REPO, `${repoPath}/${branch}/${relPath}`);
		const destDeletedPathSplit = destDeleted.split("/");
		const destDeletedBasePath = destDeletedPathSplit.slice(0, destDeletedPathSplit.length-1).join("/");

		if (fs.existsSync(destDeleted)) { return; }
		// Create directories
		if (!fs.existsSync(destDeletedBasePath)) {
			// Add file in .deleted repo
			fs.mkdirSync(destDeletedBasePath, { recursive: true });
		}
		// File destination will be created or overwritten by default.
		fs.copyFileSync(filePath, destDeleted);
		manageDiff(repoPath, branch, relPath, "", false, false, true);
		next();
	});
};
