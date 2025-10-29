

import { GoogleGenAI, Modality, LiveServerMessage } from "@google/genai";
import type { Blob } from "@google/genai";

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

export const getAnswer = async (question: string, documentContent: string): Promise<string> => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-pro",
      contents: `Based on the following document, answer the user's question. If the answer isn't in the document, say so.\n\nDOCUMENT:\n${documentContent}\n\nQUESTION:\n${question}`,
    });
    return response.text;
  } catch (error) {
    console.error("Error getting answer:", error);
    return "Sorry, I encountered an error trying to answer your question.";
  }
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

async function decodeAudioData(
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


// Text-to-Speech
export const readAloud = async (text: string): Promise<Uint8Array | null> => {
    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text: `Read this summary naturally: ${text}` }] }],
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: 'Kore' },
                    },
                },
            },
        });
        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (base64Audio) {
            return decode(base64Audio);
        }
        return null;
    } catch (error) {
        console.error("Error with text-to-speech:", error);
        return null;
    }
};

// Live API for Voice Chat
// FIX: The 'LiveSession' type is not exported from '@google/genai'. The return type is inferred instead.
export const createLiveSession = (
    onMessage: (message: LiveServerMessage) => void,
    onError: (e: ErrorEvent) => void,
    onClose: (e: CloseEvent) => void,
) => {
    const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
            onopen: () => console.log('Live session opened.'),
            onmessage: onMessage,
            onerror: onError,
            onclose: onClose,
        },
        config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
            },
            systemInstruction: 'You are a helpful research assistant. Your answers should be based on the document provided in the conversation history. Be concise.',
        },
    });
    return sessionPromise;
};

export const createAudioBlob = (data: Float32Array): Blob => {
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

export { decodeAudioData };