import { announce, stopFeedback } from '../navigation/feedback';
let lastMessage = '';
export async function speak(message: string, _announce = true) { lastMessage = message; announce(message); }
export async function repeatLast() { if (lastMessage) announce(lastMessage); }
export async function stopSpeaking() { stopFeedback(); }
export function getLastMessage() { return lastMessage; }
