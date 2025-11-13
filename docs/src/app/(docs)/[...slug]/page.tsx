import { createRelativeLink } from "fumadocs-ui/mdx";
import {
	DocsBody,
	DocsDescription,
	DocsPage,
	DocsTitle,
} from "fumadocs-ui/page";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Banners } from "@/components/banners";
import { LLMCopyButton, ViewOptions } from "@/components/page-actions";
import { source } from "@/lib/source";
import { getMDXComponents } from "@/mdx-components";

export default async function Page(props: {
	params: Promise<{ slug?: string[] }>;
}) {
	const params = await props.params;
	const page = source.getPage(params.slug);
	if (!page) notFound();

	// Async mode - load the compiled content at runtime
	const { body: MDXContent, toc } = await page.data.load();

	// To switch back to sync mode, comment out the line above and uncomment below:
	// const MDXContent = page.data.body;
	// const toc = page.data.toc;

	return (
		<DocsPage toc={toc} full={page.data.full}>
			<DocsTitle>{page.data.title}</DocsTitle>
			<DocsDescription>{page.data.description}</DocsDescription>
			<Banners />
			<DocsBody>
				<div className="flex flex-row gap-2 items-center border-b pt-2 pb-6">
					<LLMCopyButton
						markdownUrl={`https://raw.githubusercontent.com/OpenZeppelin/docs/refs/heads/main/content/${page.path}`}
					/>
					<ViewOptions
						markdownUrl={`https://raw.githubusercontent.com/OpenZeppelin/docs/refs/heads/main/content/${page.path}`}
					/>
				</div>
				<MDXContent
					components={getMDXComponents({
						// this allows you to link to other pages with relative file paths
						a: createRelativeLink(source, page),
					})}
				/>
			</DocsBody>
		</DocsPage>
	);
}

export async function generateStaticParams() {
	return source.generateParams();
}

export async function generateMetadata(props: {
	params: Promise<{ slug?: string[] }>;
}): Promise<Metadata> {
	const params = await props.params;
	const page = source.getPage(params.slug);
	if (!page) notFound();

	const url = `https://docs.openzeppelin.com${page.url}`;

	return {
		title: page.data.title,
		description:
			page.data.description ||
			"The official documentation for OpenZeppelin Libraries and Tools",
		openGraph: {
			title: page.data.title,
			description:
				page.data.description ||
				"The official documentation for OpenZeppelin Libraries and Tools",
			url,
			siteName: "OpenZeppelin Docs",
			type: "article",
			images: [
				{
					url: "/social.png",
					width: 1200,
					height: 630,
					alt: page.data.title,
				},
			],
		},
		twitter: {
			card: "summary_large_image",
			title: page.data.title,
			description:
				page.data.description ||
				"The official documentation for OpenZeppelin Libraries and Tools",
			images: ["/social.png"],
		},
		alternates: {
			canonical: url,
		},
	};
}
