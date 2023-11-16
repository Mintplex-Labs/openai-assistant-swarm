import OpenAI from "openai";
import SwarmManager from "./manager/index.js";

export interface OpenAIExtended extends OpenAI {
  beta: OpenAI["beta"] & {
    assistants: OpenAI["beta"]["assistants"] & {
      swarm: SwarmManager;
    };
  };
}

export function EnableSwarmAbilities(
  client: OpenAI,
  options?: SwarmManager["options"],
) {
  if (!client.hasOwnProperty("beta"))
    throw new Error("Beta submodule does not exist on client!");
  if (!client.beta.hasOwnProperty("assistants"))
    throw new Error("Beta Assistant submodule does not exist on client!");
  (client.beta.assistants as any).swarm = new SwarmManager(client, options);
  return client as OpenAIExtended;
}
