/* The app has no React providers: theme is a `dark` class on <html> (see
 * models/core/theme.ts), and overlays portal to document.body through Base UI
 * or the overlay stack in src/controllers/overlay. So the preview only loads the stylesheet and
 * flips that class from the toolbar. */
import type { Decorator, Preview } from "@storybook/react-vite";
import "../src/app/styles.css";

const withTheme: Decorator = (Story, context) => {
	document.documentElement.classList.toggle("dark", context.globals.theme === "dark");
	return <Story />;
};

const preview: Preview = {
	decorators: [withTheme],
	globalTypes: {
		theme: {
			description: "App theme",
			toolbar: {
				title: "Theme",
				icon: "mirror",
				items: [
					{ value: "light", title: "Light" },
					{ value: "dark", title: "Dark" },
				],
				dynamicTitle: true,
			},
		},
	},
	initialGlobals: { theme: "light" },
	parameters: {
		layout: "padded",
		options: {
			storySort: {
				order: [
					"Foundations",
					[
						"Overview",
						"Colors",
						"Typography",
						"Spacing",
						"Sizing & Density",
						"Radius",
						"Borders",
						"Shadows & Elevation",
						"Icons",
						"Motion",
						"Theme Check",
					],
					"Components",
					"Patterns",
				],
			},
		},
	},
};

export default preview;
