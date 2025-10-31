




import { GoogleGenAI, Modality, LiveServerMessage, Chat } from "@google/genai";
// FIX: Renamed imported `Blob` type to `GenAIBlob` to avoid conflict with the native browser `Blob` constructor.
import type { Blob as GenAIBlob } from "@google/genai";
import type { ChatMessage } from '../types';

const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  throw new Error("API_KEY environment variable not set");
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

// Text Generation
export const getSummary = async (documentContent: string): Promise<string> => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-pro",
      contents: `Provide a concise, one-paragraph summary of the following academic paper:\n\n${documentContent}`,
    });
    return response.text;
  } catch (error) {
    console.error("Error getting summary:", error);
    return "Sorry, I couldn't generate a summary for this document.";
  }
};

export const getTitleFromSummary = async (summary: string): Promise<string> => {
    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: `Based on the following summary, create a short, descriptive title of 8 words or less.\n\nSUMMARY:\n${summary}`,
        });
        return response.text.replace(/"/g, ''); // Remove quotes from title
    } catch (error) {
        console.error("Error getting title:", error);
        return "Untitled Notebook";
    }
};

export const createChatSession = (documentContent: string, chatHistory: ChatMessage[] = []): Chat => {
  const systemInstruction = `Based on the following document, answer the user's question. If the answer isn't in the document, say so. Be helpful and concise. The conversation may have started with a summary of the document.

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

  const chat = ai.chats.create({
    model: 'gemini-2.5-flash',
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
    const responseStream = await ai.models.generateContentStream({
      model: "gemini-2.5-flash-preview-tts",
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
    private inputWorkletNode: AudioWorkletNode | null = null;
    private mediaStreamSource: MediaStreamAudioSourceNode | null = null;
    private sessionPromise: Promise<Awaited<ReturnType<GoogleGenAI['live']['connect']>>> | null = null;
    private emitter = new EventEmitter();

    public on = this.emitter.on.bind(this.emitter);
    public off = this.emitter.off.bind(this.emitter);

    public async start(options: { language: string; documentContent: string; }) {
        if (this.sessionPromise) {
            console.warn("Session already starting.");
            return;
        }

        const langMap: { [key: string]: string } = {
            'en-US': 'English', 'pt-BR': 'Portuguese (Brazil)', 'es-ES': 'Spanish (Spain)',
            'fr-FR': 'French (France)', 'de-DE': 'German (Germany)',
        };
        const langName = langMap[options.language] || 'English';

        const systemInstruction = `You are a helpful and friendly research assistant. Your answers should be based on the document provided. Be concise. The user is speaking ${langName}. Please respond in ${langName}.

DOCUMENT CONTEXT:
---
${options.documentContent}
---`;

        this.sessionPromise = ai.live.connect({
            model: 'gemini-2.5-flash-native-audio-preview-09-2025',
            callbacks: {
                onopen: () => this.emitter.emit('open'),
                onmessage: this.handleMessage.bind(this),
                onerror: (e) => this.emitter.emit('error', e),
                onclose: (e) => this.emitter.emit('close', e),
            },
            config: {
                responseModalities: [Modality.AUDIO],
                inputAudioTranscription: {},
                outputAudioTranscription: {},
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
                systemInstruction: { parts: [{ text: systemInstruction }] },
            },
        });

        try {
            this.session = await this.sessionPromise;
            await this.startMicrophone();
        } catch (error) {
            console.error("Failed to connect live session:", error);
            const errorEvent = new ErrorEvent('connection-error', { error: error as Error });
            this.emitter.emit('error', errorEvent);
        }
    }

    private handleMessage(message: LiveServerMessage) {
        const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
        if (base64Audio) {
            this.emitter.emit('audioChunk', decode(base64Audio));
        }

        if (message.serverContent?.interrupted) {
            this.emitter.emit('interrupted');
        }

        if (message.serverContent?.inputTranscription) {
            this.emitter.emit('inputTranscription', {
                text: message.serverContent.inputTranscription.text,
                isFinal: (message.serverContent.inputTranscription as any).isFinal ?? false,
            });
        }
        if (message.serverContent?.outputTranscription) {
             this.emitter.emit('outputTranscription', {
                text: message.serverContent.outputTranscription.text,
                isFinal: (message.serverContent.outputTranscription as any).isFinal ?? false,
            });
        }

        if (message.serverContent?.turnComplete) {
            this.emitter.emit('turnComplete');
        }
    }

    private async startMicrophone() {
        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

            this.inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            if (this.inputAudioContext.state === 'suspended') {
                await this.inputAudioContext.resume();
            }

            this.mediaStreamSource = this.inputAudioContext.createMediaStreamSource(this.mediaStream);

            const inputAudioWorkletProcessorCode = `
            class InputAudioProcessor extends AudioWorkletProcessor {
              process(inputs, outputs, parameters) {
                const inputChannel = inputs[0][0];
                if (inputChannel) {
                  this.port.postMessage(inputChannel);
                }
                return true;
              }
            }
            registerProcessor('input-audio-processor', InputAudioProcessor);
            `;
            const workletBlob = new Blob([inputAudioWorkletProcessorCode], { type: 'application/javascript' });
            const workletURL = URL.createObjectURL(workletBlob);
            
            try {
                 await this.inputAudioContext.audioWorklet.addModule(workletURL);
            } catch (e) {
                if (!(e instanceof DOMException && e.name === 'InvalidStateError')) {
                    throw e; 
                }
            }

            this.inputWorkletNode = new AudioWorkletNode(this.inputAudioContext, 'input-audio-processor');

            this.inputWorkletNode.port.onmessage = (event) => {
                const inputData = event.data;
                this.sessionPromise?.then((session) => {
                    session.sendRealtimeInput({ media: createAudioBlob(inputData) });
                });
            };

            this.mediaStreamSource.connect(this.inputWorkletNode);

        } catch (error) {
            console.error("Failed to start microphone:", error);
            const errorEvent = new ErrorEvent('microphone-error', { error: error as Error });
            this.emitter.emit('error', errorEvent);
            this.stop();
        }
    }

    public stop() {
        this.session?.close();
        this.session = null;
        this.sessionPromise = null;

        this.mediaStream?.getTracks().forEach(track => track.stop());
        this.mediaStream = null;

        this.inputWorkletNode?.port.close();
        this.inputWorkletNode?.disconnect();
        this.inputWorkletNode = null;

        this.mediaStreamSource?.disconnect();
        this.mediaStreamSource = null;

        if (this.inputAudioContext && this.inputAudioContext.state !== 'closed') {
            this.inputAudioContext.close().catch(e => console.error("Error closing input audio context:", e));
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