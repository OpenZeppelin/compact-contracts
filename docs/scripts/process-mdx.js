#!/usr/bin/env node

const fs = require("fs").promises;
const path = require("path");
const { glob } = require("glob");

async function processMdxFiles(directory) {
  if (!directory) {
    console.error("Usage: node process-mdx.js <directory>");
    process.exit(1);
  }

  const mdxFiles = await glob(`${directory}/**/*.mdx`);

  for (const mdxFile of mdxFiles) {
    console.log(`Processing: ${mdxFile}`);

    try {
      // Read original MDX file
      let content = await fs.readFile(mdxFile, "utf8");

      // Replace code blocks with includes
      content = content.replace(
        /```solidity\s*\ninclude::api:example\$([^[\]]+)\[\]\s*\n```/g,
        "<include cwd lang='solidity'>./examples/$1</include>",
      );

      content = content.replace(
        /\[source,solidity\]\s*\n----\s*\ninclude::api:example\$([^[\]]+)\[\]\s*\n----/g,
        "<include cwd lang='solidity'>./examples/$1</include>",
      );

      // Replace TIP: and NOTE: callouts with <Callout> tags
      content = content.replace(/^(TIP|NOTE):\s*(.+)$/gm, "<Callout>\n$2\n</Callout>");

      content = content.replace(
        /^(IMPORTANT|WARNING|CAUTION):\s*(.+)$/gm,
        "<Callout type='warn'>\n$2\n</Callout>",
      );

      // Handle multi-line callouts
      content = content.replace(
        /^(TIP|NOTE):\s*\n((?:.*\n?)*?)(?=\n\n|$)/gm,
        "<Callout>\n$2\n</Callout>",
      );

      content = content.replace(
        /^(IMPORTANT|WARNING|CAUTION):\s*\n((?:.*\n?)*?)(?=\n\n|$)/gm,
        "<Callout type='warn'>\n$2\n</Callout>",
      );
      // Fix HTML entities globally
      content = content
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/&#x2F;/g, "/")
        .replace(/&amp;/g, "&"); // This should be last to avoid double-decoding

      // Convert api: links to contracts/v5.x/api/ and change .adoc to .mdx
      content = content.replace(
        /\(api:([^)]+)\.adoc([^)]*)\)/g,
        "(contracts/v5.x/api/$1.mdx$2)",
      );

      // Add forward slash to image paths
      content = content.replace(
        /!\[([^\]]*)\]\(([^/)][^)]*\.(png|jpg|jpeg|gif|svg|webp))\)/g,
        "![$1](/$2)",
      );

      // Fix xref: links - remove xref: and convert .adoc to .mdx
      content = content.replace(/xref:\[([^\]]+)\]\(([^)]+)\)/g, "[$1]($2)");

      // Fix .adoc internal links to .mdx
      content = content.replace(/\]\(([^)]+)\.adoc([^)]*)\)/g, "]($1.mdx$2)");

      // Fix curly bracket file references {filename} -> filename
      content = content.replace(/\{([^}]+)\}/g, "$1");

      // Fix HTML-style callouts <dl><dt><strong>📌 NOTE</strong></dt><dd> ... </dd></dl>
      // Handle multi-line callouts by using a more permissive pattern
      content = content.replace(
        /<dl><dt><strong>[📌🔔ℹ️]\s*(NOTE|TIP|INFO)<\/strong><\/dt><dd>([\s\S]*?)<\/dd><\/dl>/g,
        "<Callout>\n$2\n</Callout>",
      );

      content = content.replace(
        /<dl><dt><strong>[⚠️🚨❗]\s*(WARNING|IMPORTANT|CAUTION|DANGER)<\/strong><\/dt><dd>([\s\S]*?)<\/dd><\/dl>/g,
        "<Callout type='warn'>\n$2\n</Callout>",
      );

      // Handle cases where </dd></dl> might be missing or malformed
      content = content.replace(
        /<dl><dt><strong>[📌🔔ℹ️]\s*(NOTE|TIP|INFO)<\/strong><\/dt><dd>([\s\S]*?)(?=\n\n|<dl>|$)/g,
        "<Callout>\n$2\n</Callout>",
      );

      content = content.replace(
        /<dl><dt><strong>[⚠️🚨❗]\s*(WARNING|IMPORTANT|CAUTION|DANGER)<\/strong><\/dt><dd>([\s\S]*?)(?=\n\n|<dl>|$)/g,
        "<Callout type='warn'>\n$2\n</Callout>",
      );

      // Fix xref patterns with complex anchors like xref:#ISRC6-\\__execute__[...]
      content = content.replace(/xref:#([^[\]]+)\[([^\]]+)\]/g, "[$2](#$1)");

      // Fix simple xref patterns
      content = content.replace(/xref:([^[\s]+)\[([^\]]+)\]/g, "[$2]($1)");

      // Clean up orphaned HTML tags from malformed callouts
      // Handle orphaned <dl><dt><strong>EMOJI TYPE</strong></dt><dd> without closing tags
      content = content.replace(
        /<dl><dt><strong>[📌🔔ℹ️]\s*(NOTE|TIP|INFO)<\/strong><\/dt><dd>\s*\n([\s\S]*?)(?=\n\n|<dl>|$)/g,
        "<Callout>\n$2\n</Callout>",
      );

      content = content.replace(
        /<dl><dt><strong>[⚠️🚨❗]\s*(WARNING|IMPORTANT|CAUTION|DANGER)<\/strong><\/dt><dd>\s*\n([\s\S]*?)(?=\n\n|<dl>|$)/g,
        "<Callout type='warn'>\n$2\n</Callout>",
      );

      // Clean up any remaining orphaned HTML tags
      content = content.replace(/<dl><dt><strong>.*?<\/strong><\/dt><dd>/g, "");
      content = content.replace(/<\/dd><\/dl>/g, "");
      content = content.replace(/<dd>/g, "");
      content = content.replace(/<\/dd>/g, "");
      content = content.replace(/<dl>/g, "");
      content = content.replace(/<\/dl>/g, "");

      // Fix AsciiDoc monospace formatting (++ to backticks)
      // Handle ++text++ -> `text`
      content = content.replace(/\+\+([^+]+)\+\+/g, "`$1`");

      // Fix any remaining ++ that might be standalone
      content = content.replace(/\+\+/g, "");

      // Write the processed content back to the same MDX file
      await fs.writeFile(mdxFile, content, "utf8");

      console.log("  ✓ Processed successfully");
    } catch (error) {
      console.log(`  ✗ Error: ${error.message}`);
    }
  }
}

const directory = process.argv[2];
processMdxFiles(directory).catch(console.error);
