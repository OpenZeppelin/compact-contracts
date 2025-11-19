import type * as React from "react";
import { cn } from "@/lib/utils";

interface GlowColor {
	from: string;
	to: string;
}

interface HeroCardProps {
	href: string;
	icon: React.ReactNode;
	title: string;
	description: string;
	glowColor?: GlowColor;
	className?: string;
}

interface FeatureCardProps {
	href: string;
	icon: React.ReactNode;
	title: string;
	description: string;
	glowColor?: GlowColor;
	className?: string;
}

interface EcosystemCardProps {
	href: string;
	icon: React.ReactNode;
	title: string;
	description: string;
	className?: string;
}

interface CommunityCardProps {
	href: string;
	icon: React.ReactNode;
	title: string;
	description: string;
	className?: string;
}

interface BannerCardProps {
	href: string;
	icon: React.ReactNode;
	title: string;
	description: string;
	badge?: string;
	className?: string;
}

// Primary Hero Card - Large card with gradient background
function HeroCard({
	href,
	icon,
	title,
	description,
	glowColor = "primary-hero",
	className,
}: Omit<HeroCardProps, "glowColor"> & { glowColor?: string }) {
	const glowClasses = {
		"primary-hero":
			"before:bg-gradient-to-r before:from-[#4945ff] before:to-[#627eea]",
	};

	return (
		<a
			href={href}
			className={cn(
				"group block bg-gradient-to-r from-card to-card/50 border rounded-xl p-4 sm:p-6 lg:p-8 mb-4 sm:mb-6 hover:border-primary hover:shadow-sm hover:-translate-y-0.5 transition-all relative overflow-hidden before:absolute before:top-0 before:left-0 before:right-0 before:h-0.5 before:opacity-100",
				glowClasses[glowColor as keyof typeof glowClasses] ||
					glowClasses["primary-hero"],
				className,
			)}
		>
			<div className="flex items-center gap-4 sm:gap-6 lg:gap-8">
				<div className="w-16 h-16 sm:w-18 sm:h-18 lg:w-20 lg:h-20 bg-secondary border rounded-xl flex items-center justify-center text-2xl sm:text-3xl flex-shrink-0">
					{icon}
				</div>
				<div className="flex-1 min-w-0">
					<h2 className="text-lg sm:text-xl lg:text-2xl font-semibold mb-2 sm:mb-3">
						{title}
					</h2>
					<p className="text-xs sm:text-sm text-muted-foreground">
						{description}
					</p>
				</div>
				<div className="text-xl sm:text-2xl text-primary flex-shrink-0 hidden sm:block">
					→
				</div>
			</div>
		</a>
	);
}

// Feature Card - Standard card with icon + title horizontal, description below
function FeatureCard({
	href,
	icon,
	title,
	description,
	glowColor = "tools",
	className,
}: Omit<FeatureCardProps, "glowColor"> & { glowColor?: string }) {
	const glowClasses = {
		tools: "before:bg-gradient-to-r before:from-[#4F55FA] before:to-[#0AC2FF]",
		evm: "before:bg-gradient-to-r before:from-[#627eea] before:to-[#4945ff]",
		starknet:
			"before:bg-gradient-to-r before:from-[#0C0C4F] before:to-[#EC796B]",
		rust: "before:bg-gradient-to-r before:from-[#ce422b] before:to-[#f74c00]",
		zk: "before:bg-gradient-to-r before:from-[#10b981] before:to-[#34d399]",
		stellar:
			"before:bg-gradient-to-r before:from-[#00d4ff] before:to-[#0099ff]",
		midnight:
			"before:bg-gradient-to-r before:from-[#8b5cf6] before:to-[#a78bfa]",
		polkadot:
			"before:bg-gradient-to-r before:from-[#e6007a] before:to-[#ff4081]",
	};

	return (
		<a
			href={href}
			className={cn(
				"group block p-4 sm:p-5 lg:p-6 bg-card border rounded-xl hover:shadow-sm hover:-translate-y-0.5 transition-all relative overflow-hidden hover:border-accent before:absolute before:top-0 before:left-0 before:right-0 before:h-0.5",
				`${glowClasses[glowColor as keyof typeof glowClasses] || glowClasses.tools} before:opacity-0 hover:before:opacity-100 before:transition-opacity`,
				className,
			)}
		>
			<div className="flex items-center gap-3 sm:gap-4 mb-2 sm:mb-3">
				<div className="w-9 h-9 sm:w-10 sm:h-10 lg:w-11 lg:h-11 bg-muted rounded-lg flex items-center justify-center flex-shrink-0">
					{icon}
				</div>
				<h3 className="text-base sm:text-lg font-semibold min-w-0">{title}</h3>
			</div>
			<p className="text-xs sm:text-sm text-muted-foreground">{description}</p>
		</a>
	);
}

// Ecosystem Card - With specific glow colors for each ecosystem
function EcosystemCard({
	href,
	icon,
	title,
	description,
	glowColor = "evm",
	className,
}: Omit<EcosystemCardProps, "glowColor"> & { glowColor?: string }) {
	const glowClasses = {
		evm: "before:bg-gradient-to-r before:from-[#627eea] before:to-[#4945ff]",
		starknet:
			"before:bg-gradient-to-r before:from-[#EC796B] before:to-[#EC796B]",
		rust: "before:bg-gradient-to-r before:from-[#12AAFF] before:to-[#9DCCED]",
		zk: "before:bg-gradient-to-r before:from-[#10b981] before:to-[#34d399]",
		stellar:
			"before:bg-gradient-to-r before:from-[#FDDA33] before:to-[#F9DF74]",
		midnight:
			"before:bg-gradient-to-r before:from-[#2600FE] before:to-[#2600FE]",
		polkadot:
			"before:bg-gradient-to-r before:from-[#e6007a] before:to-[#ff4081]",
		uniswap:
			"before:bg-gradient-to-r before:from-[#e6007a] before:to-[#FC75FE]",
		zama: "before:bg-gradient-to-r before:from-[#FFD205] before:to-[#FFD205]",
	};

	return (
		<a
			href={href}
			className={cn(
				"group block p-4 sm:p-5 lg:p-6 bg-card border rounded-xl hover:shadow-sm hover:-translate-y-0.5 transition-all relative overflow-hidden hover:border-accent before:absolute before:top-0 before:left-0 before:right-0 before:h-0.5",
				`${glowClasses[glowColor as keyof typeof glowClasses] || glowClasses.evm} before:opacity-0 hover:before:opacity-100 before:transition-opacity`,
				className,
			)}
		>
			<div className="flex items-center gap-3 sm:gap-4 mb-2 sm:mb-3">
				<div className="w-9 h-9 sm:w-10 sm:h-10 lg:w-11 lg:h-11 bg-muted rounded-lg flex items-center justify-center flex-shrink-0">
					{icon}
				</div>
				<h3 className="text-base sm:text-lg font-semibold min-w-0">{title}</h3>
			</div>
			<p className="text-xs sm:text-sm text-muted-foreground">{description}</p>
		</a>
	);
}

// Community Card - Similar to FeatureCard but with different icon styling
function CommunityCard({
	href,
	icon,
	title,
	description,
	className,
}: CommunityCardProps) {
	return (
		<a
			href={href}
			target="_blank"
			className={cn(
				"group block p-5 sm:p-6 lg:p-7 bg-gradient-to-br from-card to-card/50 border rounded-xl hover:border-primary hover:shadow-sm hover:-translate-y-0.5 transition-all",
				className,
			)}
		>
			<div className="flex items-center gap-3 sm:gap-4 mb-2 sm:mb-3">
				<div className="w-10 h-10 sm:w-11 sm:h-11 lg:w-12 lg:h-12 bg-secondary rounded-lg flex items-center justify-center flex-shrink-0">
					{icon}
				</div>
				<h3 className="text-base sm:text-lg font-semibold min-w-0">{title}</h3>
			</div>
			<p className="text-xs sm:text-sm text-muted-foreground">{description}</p>
		</a>
	);
}

// Banner Card - Special layout for Ethernaut with animated shimmer
function BannerCard({
	href,
	icon,
	title,
	description,
	className,
}: BannerCardProps) {
	return (
		<a
			href={href}
			target="_blank"
			rel="noopener noreferrer"
			className={cn(
				"group flex items-center gap-4 sm:gap-6 lg:gap-8 p-4 sm:p-6 lg:p-8 bg-gradient-to-r from-card to-card/50 border rounded-xl hover:border-primary hover:shadow-sm hover:-translate-y-0.5 transition-all relative overflow-hidden before:absolute before:top-0 before:left-0 before:right-0 before:h-0.5",
				"before:bg-gradient-to-r before:from-[#4945ff] before:to-[#627eea] before:bg-[length:200%_100%] before:animate-[shimmer_3s_infinite] before:opacity-100",
				className,
			)}
		>
			<div className="w-16 h-16 sm:w-18 sm:h-18 lg:w-20 lg:h-20 bg-secondary rounded-xl flex items-center justify-center text-2xl sm:text-3xl flex-shrink-0">
				{icon}
			</div>
			<div className="flex-1 min-w-0">
				<h3 className="text-lg sm:text-xl font-semibold mb-2">{title}</h3>
				<p className="text-xs sm:text-sm text-muted-foreground">
					{description}
				</p>
			</div>
			<div className="text-xl sm:text-2xl text-primary flex-shrink-0 hidden sm:block">
				→
			</div>
		</a>
	);
}

export {
	HeroCard,
	FeatureCard,
	EcosystemCard,
	CommunityCard,
	BannerCard,
	type GlowColor,
};
