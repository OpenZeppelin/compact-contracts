const fs = require("fs");
const path = require("path");

function processFile(filePath) {
	try {
		const content = fs.readFileSync(filePath, "utf8");
		// Preserve brackets inside code fences (```...```)
		const modifiedContent = content.replace(/```[\s\S]*?```|[{}]/g, (match) => {
			// If match contains newlines or starts with ```, it's a code block - preserve it
			return match.includes("\n") || match.startsWith("```") ? match : "";
		});
		fs.writeFileSync(filePath, modifiedContent, "utf8");
		console.log(`Processed: ${filePath}`);
	} catch (error) {
		console.error(`Error processing ${filePath}: ${error.message}`);
	}
}

function crawlDirectory(dirPath) {
	try {
		const items = fs.readdirSync(dirPath);

		for (const item of items) {
			const itemPath = path.join(dirPath, item);
			const stats = fs.statSync(itemPath);

			if (stats.isDirectory()) {
				crawlDirectory(itemPath);
			} else if (stats.isFile()) {
				processFile(itemPath);
			}
		}
	} catch (error) {
		console.error(`Error crawling directory ${dirPath}: ${error.message}`);
	}
}

// Start crawling from current directory or specify a path
const targetPath = process.argv[2] || ".";
crawlDirectory(targetPath);
