import type * as React from "react";

type Props = React.PropsWithChildren<{
	functionSignature: string;
	kind: string;
	id?: string;
}>;

export async function APIItem({
	functionSignature,
	kind,
	id,
	children,
}: Props) {
	const anchorId =
		id ?? `api-${functionSignature.replace(/\W+/g, "-").toLowerCase()}`;

	return (
		<div id={anchorId}>
			<div className="border rounded-md mb-4">
				<div className="bg-secondary flex w-full justify-between px-4">
					<p className="font-bold text-sm font-mono">{functionSignature}</p>
					<div className="flex flex-row items-center gap-2">
						<p className="font-light text-sm">{kind}</p>
						<a className="peer" data-card href={`#${anchorId}`}>
							#
						</a>
					</div>
				</div>

				<div className="px-4 py-3 prose prose-sm dark:prose-invert max-w-none">
					{children}
				</div>
			</div>
		</div>
	);
}
