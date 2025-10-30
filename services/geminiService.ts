

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
        binary += String.fromCharCode(bytes[i]); // FIX: Was String.fromCharCode(i)
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
            inputAudioTranscription: {}, // Enable transcription for user input
            outputAudioTranscription: {}, // Enable transcription for model output
            speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
            },
            systemInstruction: 'You are a helpful and friendly research assistant. Your answers should be based on the document provided. Be concise.',
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