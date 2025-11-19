import "@/app/global.css";
import { GoogleAnalytics, GoogleTagManager } from "@next/third-parties/google";
import Link from "fumadocs-core/link";
import { Banner } from "fumadocs-ui/components/banner";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import { Provider } from "./provider";

const inter = Inter({
	subsets: ["latin"],
});

export const metadata: Metadata = {
	metadataBase: new URL("https://openzeppelin-docs-v2.netlify.app"),
	title: {
		default: "OpenZeppelin Docs",
		template: "%s | OpenZeppelin Docs",
	},
	description:
		"The official documentation for OpenZeppelin Libraries and Tools",
	keywords: [
		"OpenZeppelin",
		"smart contracts",
		"Ethereum",
		"Solidity",
		"blockchain",
		"security",
		"DeFi",
		"documentation",
	],
	creator: "OpenZeppelin",
	publisher: "OpenZeppelin",
	icons: {
		icon: [
			{ url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
			{ url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
		],
		apple: [
			{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
		],
		other: [
			{
				rel: "manifest",
				url: "/site.webmanifest",
			},
		],
	},
	openGraph: {
		type: "website",
		locale: "en_US",
		url: "https://docs.openzeppelin.com",
		siteName: "OpenZeppelin Docs",
		title: "OpenZeppelin Docs",
		description:
			"The official documentation for OpenZeppelin Libraries and Tools",
		images: [
			{
				url: "/social.png",
				width: 1200,
				height: 630,
				alt: "OpenZeppelin Docs",
			},
		],
	},
	twitter: {
		card: "summary_large_image",
		site: "@OpenZeppelin",
		creator: "@OpenZeppelin",
		title: "OpenZeppelin Docs",
		description:
			"The official documentation for OpenZeppelin Libraries and Tools",
		images: ["/social.png"],
	},
	robots: {
		index: true,
		follow: true,
		googleBot: {
			index: true,
			follow: true,
			"max-video-preview": -1,
			"max-image-preview": "large",
			"max-snippet": -1,
		},
	},
};

export default function Layout({ children }: { children: ReactNode }) {
	return (
		<html lang="en" className={inter.className} suppressHydrationWarning>
			<body className="flex flex-col min-h-screen">
				<Banner
					id="telegram"
					variant="rainbow"
					rainbowColors={["#4F57FA", "#2F99FF"]}
					className="gap-1.5 text-xs sm:text-base"
				>
					<p>Join our community of builders on</p>
					<Link
						className="underline inline-flex items-center gap-1"
						href="https://t.me/openzeppelin_tg"
					>
						Telegram!
						<svg
							xmlns="http://www.w3.org/2000/svg"
							className="h-6 w-6"
							viewBox="0 0 24 24"
						>
							<title>Telegram</title>
							<path
								fill="currentColor"
								d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10s10-4.48 10-10S17.52 2 12 2m4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19c-.14.75-.42 1-.68 1.03c-.58.05-1.02-.38-1.58-.75c-.88-.58-1.38-.94-2.23-1.5c-.99-.65-.35-1.01.22-1.59c.15-.15 2.71-2.48 2.76-2.69a.2.2 0 0 0-.05-.18c-.06-.05-.14-.03-.21-.02c-.09.02-1.49.95-4.22 2.79c-.4.27-.76.41-1.08.4c-.36-.01-1.04-.2-1.55-.37c-.63-.2-1.12-.31-1.08-.66c.02-.18.27-.36.74-.55c2.92-1.27 4.86-2.11 5.83-2.51c2.78-1.16 3.35-1.36 3.73-1.36c.08 0 .27.02.39.12c.1.08.13.19.14.27c-.01.06.01.24 0 .38"
							/>
						</svg>
					</Link>
				</Banner>
				<GoogleTagManager gtmId={process.env.NEXT_PUBLIC_GTM_ID as string} />
				<GoogleAnalytics gaId={process.env.NEXT_PUBLIC_GA_ID as string} />
				<Provider>{children}</Provider>
			</body>
		</html>
	);
}
