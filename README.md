<p align="center">
  <img src="https://github.com/Mintplex-Labs/openai-assistant-swarm/blob/master/images/readme.png?raw=true" alt="OpenAI Assistant Swarm Manager banner">
</p>

<p align="center">
    <b>OpenAI Assistant Swarm Manager: A library to turn your OpenAi assistants into an army</i></b>.
</p>

<p align="center">
  <a href="https://discord.gg/6UyHPeGZAC" target="_blank">
      <img src="https://img.shields.io/badge/chat-mintplex_labs-blue.svg?style=flat&logo=data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAMAAABEpIrGAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAH1UExURQAAAP////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////r6+ubn5+7u7/3+/v39/enq6urq6/v7+97f39rb26eoqT1BQ0pOT4+Rkuzs7cnKykZKS0NHSHl8fdzd3ejo6UxPUUBDRdzc3RwgIh8jJSAkJm5xcvHx8aanqB4iJFBTVezt7V5hYlJVVuLj43p9fiImKCMnKZKUlaaoqSElJ21wcfT09O3u7uvr6zE0Nr6/wCUpK5qcnf7+/nh7fEdKTHx+f0tPUOTl5aipqiouMGtubz5CRDQ4OsTGxufn515hY7a3uH1/gXBydIOFhlVYWvX29qaoqCQoKs7Pz/Pz87/AwUtOUNfY2dHR0mhrbOvr7E5RUy8zNXR2d/f39+Xl5UZJSx0hIzQ3Odra2/z8/GlsbaGjpERHSezs7L/BwScrLTQ4Odna2zM3Obm7u3x/gKSmp9jZ2T1AQu/v71pdXkVISr2+vygsLiInKTg7PaOlpisvMcXGxzk8PldaXPLy8u7u7rm6u7S1tsDBwvj4+MPExbe4ueXm5s/Q0Kyf7ewAAAAodFJOUwAABClsrNjx/QM2l9/7lhmI6jTB/kA1GgKJN+nea6vy/MLZQYeVKK3rVA5tAAAAAWJLR0QB/wIt3gAAAAd0SU1FB+cKBAAmMZBHjXIAAAISSURBVDjLY2CAAkYmZhZWNnYODnY2VhZmJkYGVMDIycXNw6sBBbw8fFycyEoYGfkFBDVQgKAAPyMjQl5IWEQDDYgIC8FUMDKKsmlgAWyiEBWMjGJY5YEqxMAqGMWFNXAAYXGgAkYJSQ2cQFKCkYFRShq3AmkpRgYJbghbU0tbB0Tr6ukbgGhDI10gySfBwCwDUWBsYmpmDqQtLK2sbTQ0bO3sHYA8GWYGWWj4WTs6Obu4ami4OTm7exhqeHp5+4DCVJZBDmqdr7ufn3+ArkZgkJ+fU3CIRmgYWFiOARYGvo5OQUHhEUAFTkF+kVHRsLBgkIeyYmLjwoOc4hMSk5JTnINS06DC8gwcEEZ6RqZGlpOfc3ZObl5+gZ+TR2ERWFyBQQFMF5eklmqUpQb5+ReU61ZUOvkFVVXXQBSAraitq29o1GiKcfLzc29u0mjxBzq0tQ0kww5xZHtHUGeXhkZhdxBYgZ4d0LI6c4gjwd7siQQraOp1AivQ6CuAKZCDBBRQQQNQgUb/BGf3cqCCiZOcnCe3QQIKHNRTpk6bDgpZjRkzg3pBQTBrdtCcuZCgluAD0vPmL1gIdvSixUuWgqNs2YJ+DUhkEYxuggkGmOQUcckrioPTJCOXEnZ5JS5YslbGnuyVERlDDFvGEUPOWvwqaH6RVkHKeuDMK6SKnHlVhTgx8jeTmqy6Eij7K6nLqiGyPwChsa1MUrnq1wAAACV0RVh0ZGF0ZTpjcmVhdGUAMjAyMy0xMC0wNFQwMDozODo0OSswMDowMB9V0a8AAAAldEVYdGRhdGU6bW9kaWZ5ADIwMjMtMTAtMDRUMDA6Mzg6NDkrMDA6MDBuCGkTAAAAKHRFWHRkYXRlOnRpbWVzdGFtcAAyMDIzLTEwLTA0VDAwOjM4OjQ5KzAwOjAwOR1IzAAAAABJRU5ErkJggg==" alt="Discord">
  </a> |
  <a href="https://github.com/Mintplex-Labs/openai-assistant-swarm/blob/master/LICENSE" target="_blank">
      <img src="https://img.shields.io/static/v1?label=license&message=MIT&color=white" alt="License">
  </a> |
   <a href="https://mintplexlabs.com" target="_blank">
    Mintplex Labs Inc
  </a>
</p>

## What is the Swarm Manager
OpenAI's assistant API unlocks an incredible convience for developers who are building autonomous AI assistants or commonly called "Agents". This Node JS Library unlocks your entire registry of custom agents and their functions via a single API call. One agent "manager" can now easily delegate work to one or many other assistants concurrently.

All of the mental overhead of managing which assistant does what is now handled and wrapped up with a bow.

## How does it work?
The Swarm Manager acts as an extension of the OpenAI NodeJS SDK - making available a new `.swarm` method available on `beta.assistants`.

First, install the openai SDK for NodeJS
```shell
yarn add openai
# or 
npm install openai
```

Next install the `openai-assistant-swarm` package
```shell
yarn add @mintplex-labs/openai-assistant-swarm
# or 
npm install @mintplex-labs/openai-assistant-swarm
```

Now use the SDK as you normally would and run the extension function and initialize the agent swarm manager.
```javascript
// Enable the client for OpenAi as you normally would
const OpenAIClient = (
    new OpenAI({
        apiKey: process.env.OPEN_AI_KEY
    }));

// The simply call this function on the client to extend the OpenAI SDK to now have
// OpenAIClient.beta.assistants.swarm functions available.
EnableSwarmAbilities(OpenAIClient, {
  // all options are OPTIONAL
  debug: false, // to see console log outputs of the process and playground links for debugging.
  managerAssistantOptions: {
         name: "[AUTOMATED] ___Swarm Manager", // Name of created/maintained agent by the library
        model: "gpt-3.5-turbo", // Use gpt-4 for better reasoning and calling.
        instructions: 'Instructions you are going to give the agent manager to delegate tasks to'; // Override the default instructions.
    };
});

// Initialize the swarm manager to create the swarm manager and also register it with
// your account. Swarm manager can be configured via options on `EnableSwarmAbilities`
await OpenAIClient.beta.assistants.swarm.init();
// Now all swarm management function are available to you!
```

## Available tools

**Delegation via prompt**

First, the main one you are probably interested in - delegation to sub-assistants. Its easy to set up and
also to listen to events and add into your current workflow.
```javascript
// Set up an event listener for when the parent response is completed so you don't have to wait
// for parent + children responses to all complete.
// Useful to return the parent response early while you work on the subtask tool_calls that 
// may or not be required depending on what happened.
OpenAIClient.beta.assistants.swarm.emitter.on('parent_assistant_complete', (args) => {
    console.group('Parent assistant response completed');
    console.log(args.parentRun.playground) // => https://platform.openai.com/playground.... to debug thread & run in browser.
    console.log(args.parentRun.textResponse) // => Yarrh! Want to be speaking to the captain do ya? Ill go fetch them ya land lubber.
    // args.parentRun => The full Run object from OpenAI so you can get the thread_id and other properties like status.
    console.log('\n\n')
    console.groupEnd();
});

// Set up an event listener for when the delegated assistant responses are completed so you don't have to wait
// for parent + children responses to all complete.
// From here you can handle all sub-run tool_calls if they are required to be run.
OpenAIClient.beta.assistants.swarm.emitter.on('child_assistants_complete', (args) => {
    console.group('Child assistant response completed');
    console.log(args.subRuns.map((run) => run.textResponse)) // => Yarrh! I am the captain of this vessel. Ye be after my treasure, Yar?
    console.log(args.subRuns.map((run) => run.playground)) // => https://platform.openai.com/playground.... to debug thread & run in browser.
    // args.subRuns[x].run => The full Run object from OpenAI so you can get the thread_id and other properties like status.
    console.log('\n\n')
    console.groupEnd();
});

// Run the main process on a single text prompt to have work delegate between all of the possible assistants that are available.
const response = OpenAIClient.beta.assistants.swarm.delegateWithPrompt('Let me speak to the head pirate of this vessel! What say ye??');
// You can also just wait for the entire flow to finish instead of setting up listeners to keep the code more synchronous
console.log({
  parentRun: response.parentRun,
  subRuns: response.subRuns,
})

// You can also focus the given task or prompt on a subset of assistants that you know you want to handle delegated work.
// OpenAIClient.beta.assistants.swarm.delegateWithPrompt('Let me speak to the head pirate of this vessel! What say ye??', ['asst_lead_pirate']);
```

**Get all available assistants**

Right now, you need to paginate assitants to see who is around to answer a question or handle a task. Now, you can just make one call and we handle pagination for you
```javascript
const allAssistants = await OpenAIClient.beta.assistants.swarm.allAssistants();
console.log(`Found ${allAssistants.length} assistants for this OpenAI Account`);
// will be an array of assistant objects you can filter or manage. The Swarm Manager will not appear here.
```

**Get many known assistants at once**

You are limited to fetching one assistant at a time via the API. Now you can get many at once
```javascript
const assistantIds = ['asst_customer_success', 'asst_lead_pirate_manager', 'asst_that_was_deleted' ]
const specificAssistants = await OpenAIClient.beta.assistants.swarm.getAssistants(assistantIds);
console.log(`Found ${specificAssistants.length} assistants from ${assistantIds.length} ids given.`);
// Will be an array of assistant objects you can filter or manage. The Swarm Manager will not appear here.
// Invalid assistants will not appear in the end result.
```