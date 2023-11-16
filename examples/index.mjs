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
        model: 'gpt-4'
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
OpenAIClient.beta.assistants.swarm.emitter.on('parent_assistant_complete', (args) => {
    console.group('Parent assistant response completed');
    console.log(args.parentRun.playground)
    console.log(args.parentRun.textResponse)
    console.log('\n\n')
    console.groupEnd();
});

// Set up an event listener for when the delegated assistant responses are completed so you don't have to wait
// for parent + children responses to all complete.
OpenAIClient.beta.assistants.swarm.emitter.on('child_assistants_complete', (args) => {
    console.group('Child assistant response completed');
    console.log(args.subRuns.map((run) => run.textResponse))
    console.log(args.subRuns.map((run) => run.playground))
    console.log('\n\n')
    console.groupEnd();
});

// Run the main process on a single text prompt to have work delegate between all of your assistants that are available.
OpenAIClient.beta.assistants.swarm.delegateWithPrompt('I want to close my account for rambat1010@gmail.com. I am unhappy with this service.');

// Or focus the task on a subset of assistants that you know you want to handle delegated work.
// OpenAIClient.beta.assistants.swarm.delegateWithPrompt('Let me speak to the head pirate of this vessel! What say ye??', ['asst_primary']);