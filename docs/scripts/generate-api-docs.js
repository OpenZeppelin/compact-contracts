#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

// Parse command line arguments
function parseArgs() {
	const args = process.argv.slice(2);
	const options = {
		contractsRepo:
			"https://github.com/stevedylandev/openzeppelin-contracts.git",
		contractsBranch: "master",
		tempDir: "temp-contracts",
		apiOutputDir: "content/contracts/5.x/api",
		examplesOutputDir: "examples",
	};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		switch (arg) {
			case "--help":
			case "-h":
				showHelp();
				process.exit(0);
				break;
			case "--repo":
			case "-r":
				options.contractsRepo = args[++i];
				break;
			case "--branch":
			case "-b":
				options.contractsBranch = args[++i];
				break;
			case "--temp-dir":
			case "-t":
				options.tempDir = args[++i];
				break;
			case "--api-output":
			case "-a":
				options.apiOutputDir = args[++i];
				break;
			case "--examples-output":
			case "-e":
				options.examplesOutputDir = args[++i];
				break;
			default:
				console.error(`Unknown option: ${arg}`);
				showHelp();
				process.exit(1);
		}
	}

	return options;
}

function showHelp() {
	console.log(`
Generate OpenZeppelin Contracts API documentation

Usage: node generate-api-docs.js [options]

Options:
  -r, --repo <url>           Contracts repository URL (default: https://github.com/OpenZeppelin/openzeppelin-contracts.git)
  -b, --branch <branch>      Contracts repository branch (default: master)
  -t, --temp-dir <dir>       Temporary directory for cloning (default: temp-contracts)
  -a, --api-output <dir>     API documentation output directory (default: content/contracts/v5.x/api)
  -e, --examples-output <dir> Examples output directory (default: examples)
  -h, --help                 Show this help message

Examples:
  node generate-api-docs.js
  node generate-api-docs.js --repo https://github.com/myorg/contracts.git --branch v4.0
  node generate-api-docs.js --api-output content/contracts/v4.x/api --examples-output examples-v4
`);
}

async function generateApiDocs(options) {
	const {
		contractsRepo,
		contractsBranch,
		tempDir,
		apiOutputDir,
		examplesOutputDir,
	} = options;

	console.log("🔄 Generating OpenZeppelin Contracts API documentation...");
	console.log(`📦 Repository: ${contractsRepo}`);
	console.log(`🌿 Branch: ${contractsBranch}`);
	console.log(`📂 API Output: ${apiOutputDir}`);
	console.log(`📂 Examples Output: ${examplesOutputDir}`);

	try {
		// Clean up previous runs
		console.log("🧹 Cleaning up previous runs...");
		await fs.rm(tempDir, { recursive: true, force: true });
		await fs.rm(apiOutputDir, { recursive: true, force: true });

		// Create output directory
		await fs.mkdir(apiOutputDir, { recursive: true });

		// Clone the contracts repository
		console.log("📦 Cloning contracts repository...");
		execSync(
			`git clone --depth 1 --branch "${contractsBranch}" --recurse-submodules "${contractsRepo}" "${tempDir}"`,
			{
				stdio: "inherit",
			},
		);

		// Navigate to contracts directory and install dependencies
		console.log("📚 Installing dependencies...");
		const originalDir = process.cwd();
		process.chdir(tempDir);

		try {
			execSync("npm install --silent", { stdio: "inherit" });

			// Generate markdown documentation
			console.log("🏗️  Generating clean markdown documentation...");
			execSync("npm run prepare-docs", { stdio: "inherit" });

			// Copy generated markdown files
			console.log("📋 Copying generated documentation...");
			const docsPath = path.join("docs", "modules", "api", "pages");

			try {
				await fs.access(docsPath);
				// Copy API docs
				const apiSource = path.join(process.cwd(), docsPath);
				const apiDest = path.join(originalDir, apiOutputDir);
				await copyDirRecursive(apiSource, apiDest);
				console.log(`✅ API documentation copied to ${apiOutputDir}`);
			} catch (error) {
				console.log(
					"❌ Error: Markdown documentation not found at expected location",
				);
				process.exit(1);
			}

			// Copy examples if they exist
			const examplesPath = path.join("docs", "modules", "api", "examples");
			if (
				await fs
					.access(examplesPath)
					.then(() => true)
					.catch(() => false)
			) {
				const examplesDest = path.join(originalDir, examplesOutputDir);
				await fs.mkdir(examplesDest, { recursive: true });
				await copyDirRecursive(
					path.join(process.cwd(), examplesPath),
					examplesDest,
				);
				console.log(`✅ Examples copied to ${examplesOutputDir}`);
			}

			// Get version for index file
			let version = "latest";
			try {
				const packageJson = JSON.parse(
					await fs.readFile("package.json", "utf8"),
				);
				version = packageJson.version || version;
			} catch (error) {
				console.log("⚠️  Could not read package.json for version info");
			}

			// Generate index file
			// 			console.log("📝 Generating API index...");
			// 			const indexContent = `---
			// title: API Reference
			// ---

			// # API Reference
			// `;

			// 			await fs.writeFile(
			// 				path.join(originalDir, apiOutputDir, "index.mdx"),
			// 				indexContent,
			// 				"utf8",
			// 			);
		} finally {
			// Go back to original directory
			process.chdir(originalDir);
		}

		// Clean up temporary directory
		console.log("🧹 Cleaning up...");
		await fs.rm(tempDir, { recursive: true, force: true });

		console.log("🎉 API documentation generation complete!");
		console.log(`📂 Documentation available in: ${apiOutputDir}`);
		console.log("");
		console.log("Next steps:");
		console.log(`  - Review generated markdown files in ${apiOutputDir}`);
		console.log("  - Update the api/index.mdx file with your TOC");
	} catch (error) {
		console.error("❌ Error generating API documentation:", error.message);
		process.exit(1);
	}
}

async function copyDirRecursive(src, dest) {
	const entries = await fs.readdir(src, { withFileTypes: true });

	for (const entry of entries) {
		const srcPath = path.join(src, entry.name);
		const destPath = path.join(dest, entry.name);

		if (entry.isDirectory()) {
			await fs.mkdir(destPath, { recursive: true });
			await copyDirRecursive(srcPath, destPath);
		} else {
			await fs.copyFile(srcPath, destPath);
		}
	}
}

// Main execution
const options = parseArgs();
generateApiDocs(options);
