import { createFileRoute } from "@tanstack/react-router";
import { checkOllamaHealth, getOllamaConfig, jsonResponse } from "@/lib/ollama-fashion";

function localEnv() {
  return typeof process === "undefined" ? {} : process.env;
}

export const Route = createFileRoute("/api/ollama-health")({
  server: {
    handlers: {
      GET: async () => {
        const config = getOllamaConfig(localEnv());
        const health = await checkOllamaHealth(config);
        return jsonResponse(health, health.status === "ollama_connected" ? 200 : 503);
      },
    },
  },
});
