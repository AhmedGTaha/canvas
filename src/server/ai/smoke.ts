import { getAIProvider } from "./provider-registry";

const provider = getAIProvider();
const response = await provider.generateText({ systemInstructions: "Reply with exactly: Canvas AI ready", messages: [{ role: "user", parts: [{ type: "text", text: "Small connectivity check." }] }], maxOutputTokens: 20, temperature: 0 });
console.log(`${response.provider}/${response.model}: ${response.text}`);
