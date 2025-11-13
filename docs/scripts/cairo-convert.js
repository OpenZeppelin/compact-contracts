const fs = require("fs");
const path = require("path");

function crawlDirectory(dir) {
	const items = fs.readdirSync(dir);

	for (const item of items) {
		const fullPath = path.join(dir, item);
		const stat = fs.statSync(fullPath);

		if (stat.isDirectory()) {
			crawlDirectory(fullPath);
		} else if (stat.isFile()) {
			processFile(fullPath);
		}
	}
}

function processFile(filePath) {
	try {
		const content = fs.readFileSync(filePath, "utf8");
		const updatedContent = content.replace(/```rust/g, "```rust");

		if (content !== updatedContent) {
			fs.writeFileSync(filePath, updatedContent, "utf8");
			console.log(`Updated: ${filePath}`);
		}
	} catch (error) {
		console.error(`Error processing ${filePath}:`, error.message);
	}
}

// Start crawling from current directory or specify a path
const targetDirectory = process.argv[2] || ".";
crawlDirectory(targetDirectory);
