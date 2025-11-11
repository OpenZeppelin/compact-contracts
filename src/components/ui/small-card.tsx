import Link, { type LinkProps } from "fumadocs-core/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type CardProps = {
	icon?: ReactNode;
	title: string;
	description: string;
	innerClassName?: string;
	variant?: "default" | "secondary";
} & Omit<LinkProps, "title">;

export type SmallCardProps = {
	icon: ReactNode;
	title: string;
	description: string;
} & Omit<LinkProps, "title">;

export function SmallCard({
	icon,
	title,
	description,
	...props
}: CardProps): React.ReactElement {
	return (
		<Link
			{...props}
			className={cn(
				"not-prose block transition-all duration-100 ease-linear space-y-3",
				props.className,
			)}
		>
			<div className="group flex space-x-4 px-3 py-4 rounded-lg hover:bg-card transition-all duration-100 ease-linear">
				{icon && (
					<div className="h-fit w-fit rounded-md border bg-card group-hover:bg-background transition-all duration-100 ease-linear p-2 text-muted-foreground [&_svg]:size-4">
						{icon}
					</div>
				)}
				<div className="flex flex-col w-full">
					<h3 className="mb-1 font-inter font-medium text-md text-foreground dark:text-[#f6f5f3]">
						{title}
					</h3>
					<p className="text-sm text-muted-foreground">{description}</p>
				</div>
			</div>
		</Link>
	);
}
