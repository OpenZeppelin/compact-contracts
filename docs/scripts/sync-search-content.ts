import { algoliasearch } from "algoliasearch";
import { sync, type DocumentRecord } from "fumadocs-core/search/algolia";
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";

// the path of pre-rendered `static.json`, choose one according to your React framework
const filePath = {
	next: ".next/server/app/static.json.body",
	"tanstack-start": ".output/public/static.json",
	"react-router": "build/client/static.json",
	waku: "dist/public/static.json",
}["next"];

const client = algoliasearch(
	`${process.env.NEXT_PUBLIC_ALGOLIA_ID}`,
	`${process.env.ALGOLIA_PRIVATE_KEY}`,
);

// Write the route file to src/app/static.json/route.ts
const tempFilePath = path.join("src", "app", "static.json", "route.ts");
const fileContent = `import { exportSearchIndexes } from '@/lib/export-search-indexes';

export const revalidate = false;

export async function GET() {
  return Response.json(await exportSearchIndexes());
}
`;

// Ensure directory exists
fs.mkdirSync(path.dirname(tempFilePath), { recursive: true });
fs.writeFileSync(tempFilePath, fileContent);

try {
	// Run the build command
	console.log("Running build...");
	execSync("npm run build", { stdio: "inherit" });

	// Read the generated static.json file
	const content = fs.readFileSync(filePath);
	const records = JSON.parse(content.toString()) as DocumentRecord[];

	// update the index settings and sync search indexes
	console.log("Syncing search indexes...");
	await sync(client, {
		indexName: "document",
		documents: records,
	});
} finally {
	// Remove the temporary file after script completion
	if (fs.existsSync(tempFilePath)) {
		fs.unlinkSync(tempFilePath);
		console.log("Cleaned up temporary route file");
	}
}
