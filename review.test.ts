import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import reviewExtension from "./review.ts";

const prUrl = "https://github.com/BIGGASSS/open-orpheus/pull/4";

type ReviewCommand = Parameters<ExtensionAPI["registerCommand"]>[1];

async function runPrReview(ref: string, viaMenu = false) {
	let review: ReviewCommand | undefined;
	const prCalls: string[][] = [];
	const notifications: string[] = [];
	const menuChoices = viaMenu ? ["pullRequest", null] : [null];

	const pi = {
		on() {},
		registerCommand(name: string, command: ReviewCommand) {
			if (name === "review") review = command;
		},
		async exec(command: string, args: string[]) {
			if (command === "gh" && args[0] === "pr") {
				prCalls.push(args);
				if (args[1] === "view") {
					return {
						code: 0,
						stdout: JSON.stringify({ baseRefName: "main", title: "Test PR", headRefName: "feature" }),
						stderr: "",
					};
				}
				assert.equal(args[1], "checkout");
			} else {
				assert.ok(
					command === "git" || (command === "gh" && ["--version", "auth"].includes(args[0])),
					`Unexpected command: ${command} ${args.join(" ")}`,
				);
			}
			return { code: 0, stdout: "", stderr: "" };
		},
	} as unknown as ExtensionAPI;

	const ctx = {
		hasUI: true,
		ui: {
			notify(message: string) { notifications.push(message); },
			custom: async () => menuChoices.shift() ?? null,
			editor: async () => ref,
			// Stop after checkout, before starting an agent review or modifying session state.
			select: async () => undefined,
		},
		sessionManager: { getEntries: () => [{ type: "message" }] },
	} as unknown as ExtensionCommandContext;

	reviewExtension(pi);
	assert.ok(review);
	await review.handler(viaMenu ? "" : `pr "${ref}"`, ctx);
	return { prCalls, notifications };
}

for (const viaMenu of [false, true]) {
	const mode = viaMenu ? "menu" : "command";
	for (const [name, input, expected] of [
		["full URL", prUrl, prUrl],
		["scheme-less URL", "github.com/BIGGASSS/open-orpheus/pull/4", prUrl],
		["URL with whitespace", `  ${prUrl}  `, prUrl],
		["URL with fragment", `${prUrl}#discussion_r123`, `${prUrl}#discussion_r123`],
		["PR number", "4", "4"],
	]) {
		test(`${mode}: passes ${name} to both gh pr view and checkout`, async () => {
			const { prCalls, notifications } = await runPrReview(input, viaMenu);
			assert.deepEqual(prCalls, [
				["pr", "view", expected, "--json", "baseRefName,title,headRefName"],
				["pr", "checkout", expected],
			]);
			assert.ok(notifications.includes("Checked out PR #4 (feature)"));
		});
	}

	for (const input of ["0", "4oops", "https://example.com/owner/repo/pull/4", `${prUrl}oops`]) {
		test(`${mode}: rejects invalid PR reference ${input}`, async () => {
			const { prCalls, notifications } = await runPrReview(input, viaMenu);
			assert.deepEqual(prCalls, []);
			assert.ok(notifications.includes("Invalid PR reference. Enter a number or GitHub PR URL."));
		});
	}
}
