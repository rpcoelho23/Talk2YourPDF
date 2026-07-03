

import { GoogleGenAI, Modality, LiveServerMessage, Chat } from "@google/genai";
// FIX: Renamed imported `Blob` type to `GenAIBlob` to avoid conflict with the native browser `Blob` constructor.
import type { Blob as GenAIBlob } from "@google/genai";
import type { ChatMessage } from '../types';

let aiInstance: GoogleGenAI | null = null;

export const getAI = (): GoogleGenAI => {
    if (!aiInstance) {
        const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error("GEMINI_API_KEY environment variable is not set. Please set it in your environment variables.");
        }
        aiInstance = new GoogleGenAI({ apiKey });
    }
    return aiInstance;
};

// Text Generation
export const getSummary = async (documentContent: string): Promise<string> => {
  try {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: `Provide a concise, one-paragraph summary of the following academic paper:\n\n${documentContent}`,
    });
    return response.text;
  } catch (error) {
    console.error("Error getting summary:", error);
    throw error; // Propagate error so calling code can detect key/API errors
  }
};

export const getTitleFromSummary = async (summary: string): Promise<string> => {
    try {
        const ai = getAI();
        const response = await ai.models.generateContent({
            model: "gemini-3.5-flash",
            contents: `Based on the following summary, create a short, descriptive title of 8 words or less.\n\nSUMMARY:\n${summary}`,
        });
        return response.text.replace(/"/g, ''); // Remove quotes from title
    } catch (error) {
        console.error("Error getting title:", error);
        return "Untitled Notebook";
    }
};

export const createChatSession = (documentContent: string, chatHistory: ChatMessage[] = []): Chat => {
  const systemInstruction = `Based on the following document, answer the user's question directly, accurately, and concisely. If the answer isn't in the document, say so. 

CRITICAL DIRECTIVES:
- Do not guess or speculate on what the user's next step is.
- Do not suggest what the user might want to do next or ask unsolicited follow-up questions (such as "Are you looking for information from that paper?" or proposing what to read/do next).
- Simply answer the exact question asked and STOP. Avoid any forward-looking or proactive conversational fillers.

DOCUMENT:
---
${documentContent}
---`;

    const historyForGemini = chatHistory.map(msg => ({
        role: msg.sender === 'user' ? 'user' as const : 'model' as const,
        parts: [{ text: msg.text }]
    }));

    // For context, if the chat history starts with just the AI's summary,
    // we prepend the user's implicit prompt that generated it.
    if (historyForGemini.length === 1 && historyForGemini[0].role === 'model') {
        historyForGemini.unshift({
            role: 'user' as const,
            parts: [{ text: `Provide a concise, one-paragraph summary of the provided document.` }]
        });
    }

  const ai = getAI();
  const chat = ai.chats.create({
    model: 'gemini-3.5-flash',
    history: historyForGemini,
    config: {
      systemInstruction: systemInstruction,
    },
  });
  return chat;
};


// Audio Decoding/Encoding Utilities
export const decode = (base64: string): Uint8Array => {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
};

const encode = (bytes: Uint8Array): string => {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
};

export async function decodeAudioData(
    data: Uint8Array,
    ctx: AudioContext,
    sampleRate: number,
    numChannels: number,
): Promise<AudioBuffer> {
    const dataInt16 = new Int16Array(data.buffer);
    const frameCount = dataInt16.length / numChannels;
    const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

    for (let channel = 0; channel < numChannels; channel++) {
        const channelData = buffer.getChannelData(channel);
        for (let i = 0; i < frameCount; i++) {
            channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
        }
    }
    return buffer;
}


// Streaming Text-to-Speech for low-latency playback
export const readAloudStream = async (
  text: string,
  onAudioChunk: (chunk: Uint8Array) => void,
  signal: AbortSignal
): Promise<void> => {
  try {
    const ai = getAI();
    const responseStream = await ai.models.generateContentStream({
      model: "gemini-3.1-flash-tts-preview",
      contents: [{ parts: [{ text: `Read this text naturally: ${text}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
        },
      },
    });

    for await (const chunk of responseStream) {
      if (signal.aborted) {
        break;
      }
      const base64Audio = chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        onAudioChunk(decode(base64Audio));
      }
    }
  } catch (error) {
    if ((error as Error).name !== 'AbortError') {
       console.error("Error with text-to-speech stream:", error);
       throw error;
    }
  }
};

type Listener = (...args: any[]) => void;

class EventEmitter {
    private events: { [key: string]: Listener[] } = {};

    on(event: string, listener: Listener): () => void {
        if (!this.events[event]) {
            this.events[event] = [];
        }
        this.events[event].push(listener);
        return () => this.off(event, listener);
    }

    off(event: string, listener: Listener): void {
        if (!this.events[event]) return;
        this.events[event] = this.events[event].filter(l => l !== listener);
    }

    emit(event: string, ...args: any[]): void {
        if (!this.events[event]) return;
        this.events[event].forEach(listener => listener(...args));
    }
}

// Live API for Voice Chat
export class LiveSessionManager {
    private session: Awaited<ReturnType<GoogleGenAI['live']['connect']>> | null = null;
    private inputAudioContext: AudioContext | null = null;
    private mediaStream: MediaStream | null = null;
    private scriptProcessor: ScriptProcessorNode | null = null;
    private mediaStreamSource: MediaStreamAudioSourceNode | null = null;
    private sessionPromise: Promise<Awaited<ReturnType<GoogleGenAI['live']['connect']>>> | null = null;
    private emitter = new EventEmitter();

    public on = this.emitter.on.bind(this.emitter);
    public off = this.emitter.off.bind(this.emitter);

    public async start(options: { language: string; documentSummary: string; documentContent?: string; }) {
        if (this.sessionPromise) {
            console.warn("LiveSessionManager: Start called while a session is already starting.");
            return;
        }
        console.log("LiveSessionManager: Starting new session with options:", { ...options, documentContent: options.documentContent ? `${options.documentContent.substring(0, 100)}...` : 'undefined' });

        const langMap: { [key: string]: string } = {
            'en-US': 'English', 'pt-BR': 'Portuguese (Brazil)', 'es-ES': 'Spanish (Spain)',
            'fr-FR': 'French (France)', 'de-DE': 'German (Germany)',
        };
        const langName = langMap[options.language] || 'English';

        const systemInstructionText = `You are a helpful and friendly research assistant. Your answers should be based on the provided document summary and full document content. Be concise and conversational. The user is speaking ${langName}. Please respond in ${langName}.

CRITICAL DIRECTIVES:
- Do not guess or speculate on what the user's next step is.
- Do not suggest what the user might want to do next or ask unsolicited follow-up questions (such as "Are you looking for information from that paper?" or proposing what to read/do next).
- Simply answer the exact question asked directly and STOP. Avoid any forward-looking or proactive conversational fillers.

DOCUMENT SUMMARY:
---
${options.documentSummary}
---

FULL DOCUMENT CONTENT:
---
${options.documentContent || 'No full document content was provided.'}
---`;
        
        const config = {
            responseModalities: [Modality.AUDIO],
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
            systemInstruction: systemInstructionText,
        };

        console.log("LiveSessionManager: Connecting with config:", JSON.stringify(config, null, 2));

        const ai = getAI();
        this.sessionPromise = ai.live.connect({
            model: 'gemini-3.1-flash-live-preview',
            callbacks: {
                onopen: () => {
                    console.log("LiveSessionManager: Session opened.");
                    this.emitter.emit('open');
                },
                onmessage: this.handleMessage.bind(this),
                onerror: (e) => {
                    console.error("LiveSessionManager: Received error from Gemini:", e);
                    this.emitter.emit('error', e);
                },
                onclose: (e) => {
                    console.log("LiveSessionManager: Session closed by Gemini.", e);
                    this.emitter.emit('close', e);
                },
            },
            config: config,
        });

        try {
            this.session = await this.sessionPromise;
            console.log("LiveSessionManager: Session connected successfully.");
            await this.startMicrophone();
        } catch (error) {
            console.error("LiveSessionManager: Failed to connect live session:", error);
            const errorEvent = new ErrorEvent('connection-error', { error: error as Error });
            this.emitter.emit('error', errorEvent);
        }
    }

    private handleMessage(message: LiveServerMessage) {
        // console.debug("LiveSessionManager: Received message:", message); // Can be noisy
        const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
        if (base64Audio) {
            this.emitter.emit('audioChunk', decode(base64Audio));
        }

        if (message.serverContent?.interrupted) {
            console.log("LiveSessionManager: Model turn interrupted.");
            this.emitter.emit('interrupted');
        }

        if (message.serverContent?.inputTranscription) {
            this.emitter.emit('inputTranscription', {
                text: message.serverContent.inputTranscription.text,
            });
        }
        if (message.serverContent?.outputTranscription) {
             this.emitter.emit('outputTranscription', {
                text: message.serverContent.outputTranscription.text,
            });
        }

        if (message.serverContent?.turnComplete) {
            console.log("LiveSessionManager: Turn complete.");
            this.emitter.emit('turnComplete');
        }
    }

    private async startMicrophone() {
        console.log("LiveSessionManager: Attempting to start microphone...");
        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            console.log("LiveSessionManager: Microphone access granted.");

            this.inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            if (this.inputAudioContext.state === 'suspended') {
                console.log("LiveSessionManager: Resuming suspended audio context.");
                await this.inputAudioContext.resume();
            }

            this.mediaStreamSource = this.inputAudioContext.createMediaStreamSource(this.mediaStream);
            
            this.scriptProcessor = this.inputAudioContext.createScriptProcessor(4096, 1, 1);

            this.scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
                const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                // Using sessionPromise ensures we don't send data before the connection is established.
                this.sessionPromise?.then((session) => {
                    session.sendRealtimeInput({ audio: createAudioBlob(inputData) });
                });
            };

            this.mediaStreamSource.connect(this.scriptProcessor);
            this.scriptProcessor.connect(this.inputAudioContext.destination);
            console.log("LiveSessionManager: Microphone and audio processor are now connected.");

        } catch (error) {
            console.error("LiveSessionManager: Failed to start microphone:", error);
            const errorEvent = new ErrorEvent('microphone-error', { error: error as Error });
            this.emitter.emit('error', errorEvent);
        }
    }

    public stop() {
        console.log("LiveSessionManager: Stopping session and cleaning up resources.");
        this.session?.close();
        this.session = null;
        this.sessionPromise = null;

        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
             console.log("LiveSessionManager: Media stream stopped.");
        }

        if (this.scriptProcessor) {
            this.scriptProcessor.disconnect();
            this.scriptProcessor = null;
            console.log("LiveSessionManager: Script processor disconnected.");
        }
        
        if (this.mediaStreamSource) {
            this.mediaStreamSource.disconnect();
            this.mediaStreamSource = null;
            console.log("LiveSessionManager: Media stream source disconnected.");
        }

        if (this.inputAudioContext && this.inputAudioContext.state !== 'closed') {
            this.inputAudioContext.close().then(() => {
                console.log("LiveSessionManager: Input audio context closed.");
            }).catch(e => console.error("LiveSessionManager: Error closing input audio context:", e));
            this.inputAudioContext = null;
        }
    }
}


const createAudioBlob = (data: Float32Array): GenAIBlob => {
    const l = data.length;
    const int16 = new Int16Array(l);
    for (let i = 0; i < l; i++) {
        int16[i] = data[i] * 32768;
    }
    return {
        data: encode(new Uint8Array(int16.buffer)),
        mimeType: 'audio/pcm;rate=16000',
    };
};