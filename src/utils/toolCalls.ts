import {
  RequiredActionFunctionToolCall,
  Run,
} from "openai/resources/beta/threads/runs/runs";
import { DelegatedToolCall, DelegationArguments } from "./types";
import SwarmManager from "../manager";

/**
 * Handle and parse all possible cases of tool calls
 * 1. Single call with single instruction
 * 2. single call with multiple instructions
 * 3. parallel call with multiple or single instructions
 */
export function compressToolCalls(
  swarmManager: SwarmManager,
  primaryRun: Run,
): DelegatedToolCall[] {
  return (
    primaryRun.required_action?.submit_tool_outputs?.tool_calls
      ?.map((toolCall) => {
        try {
          const isParallelCall = (toolCall.function.name =
            "multi_tool_use.parallel");
          if (isParallelCall) {
            swarmManager.log(
              `Parallel function call instruction set found - parsing`,
            );
            return parseParallelToolCall(toolCall);
          }

          swarmManager.log(
            `Single function call instruction set found - parsing`,
          );
          return parseSingleToolCall(toolCall);
        } catch {}
        return null;
      })
      ?.flat()
      ?.filter((call: any) => !!call) || []
  );
}

/**
 * Parallel calls can come in two distinct ways - as a list of instructions in a single call
 * Or bundled in an object called "tool_uses".
 * Here we can check which response mode is randomly chose and handle each.
 *  multi_tool_use.parallel({ "tool_uses": [ { "recipient_name": "functions.delegate", "parameters": { "instructions": [ {...} ] } }, { "recipient_name": "functions.delegate", "parameters": { "instructions": [ {... } ] } } ] })
 *  or
 *  tool_output({ "instructions": [ {...},{...} ] })
 */
function parseParallelToolCall(toolCall: RequiredActionFunctionToolCall) {
  let instructions;
  const callId = toolCall.id;
  const data = JSON.parse(toolCall.function.arguments);
  if (data.hasOwnProperty("tool_uses")) {
    instructions = data.tool_uses
      .map(({ parameters }: { parameters: any }) => parameters.instructions)
      .flat();
  } else {
    instructions = data.instructions;
  }

  return instructions.map((instruction: DelegationArguments) => {
    return {
      id: callId,
      function: "delegate",
      agentId: instruction.agent_id,
      args: instruction,
    };
  });
}

function parseSingleToolCall(toolCall: RequiredActionFunctionToolCall) {
  const { instructions } = JSON.parse(toolCall.function.arguments);
  return instructions.map((instruction: DelegationArguments) => {
    return {
      id: toolCall.id,
      function: toolCall.function,
      agentId: instruction.agent_id,
      args: instruction,
    };
  });
}
