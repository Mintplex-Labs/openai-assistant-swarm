import 'dotenv/config';
import OpenAI from 'openai';
import { EnableSwarmAbilities } from 'openai-assistant-swarm';

// Enable the client for OpenAi as you normally would
const OpenAIClient = (
    new OpenAI({
        apiKey: process.env.OPEN_AI_KEY
    }));

// The simply call this function on the client to extend the OpenAI SDK to now have
// OpenAIClient.beta.assistants.swarm functions available.
EnableSwarmAbilities(OpenAIClient, {
    debug: true,
    managerAssistantOptions: {
        model: 'gpt-4-1106-preview'
    }
});

// Initialize the swarm manager to create the swarm manager and also register it with
// your account. Swarm manager can be configured via options on `EnableSwarmAbilities`
await OpenAIClient.beta.assistants.swarm.init();

// // Convenience function: Get all assistants at once from account. Will exclude swarm manager assistant
// const allAssistants = await OpenAIClient.beta.assistants.swarm.allAssistants();
// console.log(`Found ${allAssistants.length} assistants for OpenAI Account`);

// // Convenience function: Get many known assistants via ID at once. Will exclude swarm manager assistant
// const assistantIds = [
//     ...allAssistants.slice(0, 2).map((a) => a.id),
//     'unknown_id'
// ]
// const specificAssistants = await OpenAIClient.beta.assistants.swarm.getAssistants(assistantIds)
// console.log(`Found ${specificAssistants.length} assistants from ${assistantIds.length} ids given.`);

// Set up an event listener for when the parent response is completed so you don't have to wait
// for parent + children responses to all complete.
// OpenAIClient.beta.assistants.swarm.emitter.on('parent_assistant_complete', ({ data }) => {
//     console.group('Parent assistant response completed');
//     console.log(data.parentRun.playground)
//     console.log(data.parentRun.textResponse)
//     console.log('\n\n')
//     console.groupEnd();
// });

// Set up an event listener for when the delegated assistant responses are completed so you don't have to wait
// for parent + children responses to all complete.
// OpenAIClient.beta.assistants.swarm.emitter.on('child_assistants_complete', ({ data }) => {
//     console.group('Child assistant response completed');
//     console.log(data.subRuns.map((run) => run.textResponse)[0])
//     console.log(data.subRuns.map((run) => run.playground)[0])
//     console.log('\n\n')
//     console.groupEnd();
// });

OpenAIClient.beta.assistants.swarm.emitter.on('poll_event', ({ data }) => {
    console.group('Generic status event - see types for what is available');
    console.log({
        status: data.status,
        text: data.prompt || data.textResponse,
        runId: data?.run?.id,
        link: data.playground,
        runStatus: data?.run?.status,
    })
    console.log('\n\n')
    console.groupEnd();
});

// Run the main process on a single text prompt to have work delegate between all of your assistants that are available.
OpenAIClient.beta.assistants.swarm.delegateWithPrompt('What is the weather in New York city right now? Also what is the top stock for today?');
// For example. Given a Pirate bot, Weather Bot, and Stock Bot
// Run threads in parallel and return to you!
// |--> Will delegate to an existing Weather Bot
// |--> Will delegate to an existing Stock watcher Bot
// -> Pirate bot will not be invoked.
// If a task is found that no assistant can handled it will be filtered out automatically. It also filters out hallucinated assistants.
// -----
// The parent will respond with something like "I've arranged for two of our assistants to handle your requests. For assistance with stocks I have delegated that task  to the Stock Bot, and for the weather update in San Francisco, our Weatherbot will provide the current conditions. They will take care of your needs shortly."
// You will then get a response once each child responds with either a completion or a `required_action` run state you can handle in code to conclude.

// Or focus the task on a subset of assistants that you know you want to handle delegated work.
// OpenAIClient.beta.assistants.swarm.delegateWithPrompt('Let me speak to the head pirate of this vessel! What say ye??', ['asst_pirate']);