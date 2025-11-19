export function ZamaIcon({
	className,
	color,
}: {
	className: string;
	color?: boolean;
}) {
	if (color) {
		return (
			<svg
				xmlns="http://www.w3.org/2000/svg"
				width="1em"
				height="1em"
				viewBox="0 0 24 24"
				className={className}
			>
				<title>Zama Icon</title>
				<rect width="24" height="24" fill="#FFD205" />
				<path d="M4 4L21 4.03174V7H4V4Z" fill="#2D2D2A" />
				<path d="M4 18H21V20.7016H4V18Z" fill="#2D2D2A" />
				<path d="M4 18L21 7V10.2369L9.52734 18H4Z" fill="#2D2D2A" />
			</svg>
		);
	} else {
		return (
			<svg
				xmlns="http://www.w3.org/2000/svg"
				width="1em"
				height="1em"
				viewBox="0 0 24 24"
				className={className}
			>
				<title>Zama Icon</title>
				<path d="M4 4L21 4.03174V7H4V4Z" fill="currentColor" />
				<path d="M4 18H21V20.7016H4V18Z" fill="currentColor" />
				<path d="M4 18L21 7V10.2369L9.52734 18H4Z" fill="currentColor" />
			</svg>
		);
	}
}
