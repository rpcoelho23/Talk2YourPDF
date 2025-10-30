
import React, { useState, useRef, useCallback, useEffect } from 'react';
import type { Source, ChatMessage, SavedNote, Notebook } from './types';
import { getSummary, getTitleFromSummary, getAnswer, readAloudStream, createLiveSession, createAudioBlob, decodeAudioData, decode } from './services/geminiService';
import type { LiveServerMessage } from '@google/ai/generativelanguage';
import {
    PdfIcon, ChartBarIcon, CheckIcon, PinIcon, SpeakerWaveIcon, MicrophoneIcon,
    StopCircleIcon, ArrowUpCircleIcon, PencilIcon, TrashIcon, ArrowDownTrayIcon, ArrowUpTrayIcon
} from './components/Icons';

// Helper to convert a File object to a Base64 Data URL for embedding and persistence
const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
  });


// Panel Header Component
interface PanelHeaderProps {
  title: string;
  children?: React.ReactNode;
}
const PanelHeader: React.FC<PanelHeaderProps> = ({ title, children }) => (
  <div className="flex items-center justify-between p-4 border-b border-gray-700">
    <h2 className="text-lg font-semibold">{title}</h2>
    <div>{children}</div>
  </div>
);

// Sources Panel Component
interface SourcesPanelProps {
  source: Source | null;
  onFileUpload: (file: File) => void;
  isLoading: boolean;
  hasActiveNotebook: boolean;
  isDocumentViewActive: boolean;
  onToggleDocumentView: () => void;
}
const SourcesPanel: React.FC<SourcesPanelProps> = ({ source, onFileUpload, isLoading, hasActiveNotebook, isDocumentViewActive, onToggleDocumentView }) => {
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleAddClick = () => {
        // Reset the value to ensure onChange fires even if the same file is selected again
        if(fileInputRef.current) {
            fileInputRef.current.value = "";
        }
        fileInputRef.current?.click();
    };

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file && file.type === 'application/pdf') {
            onFileUpload(file);
        } else if (file) {
            alert('Please upload a valid PDF file.');
        }
    };
    
  return (
    <div className="flex flex-col bg-gray-900/50 h-full rounded-lg border border-gray-700">
      <PanelHeader title="Sources" />
      <div className="p-4 space-y-4">
        <div className="flex gap-2">
            <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                className="hidden"
                accept="application/pdf"
                disabled={ (hasActiveNotebook && !!source) || isLoading}
            />
          <button onClick={handleAddClick} disabled={(hasActiveNotebook && !!source) || isLoading} className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-lg transition-colors disabled:bg-gray-800 disabled:cursor-not-allowed">
            {isLoading ? 'Processing...' : '+ Add'}
          </button>
          <button className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-lg transition-colors">
            Discover
          </button>
        </div>
        
        {source && (
            <div onClick={onToggleDocumentView} className="bg-gray-800/50 p-3 rounded-lg flex items-center justify-between cursor-pointer hover:bg-gray-700/50 transition-colors">
                <div className="flex items-center gap-3">
                    <PdfIcon className="w-5 h-5 text-red-400 flex-shrink-0" />
                    <span className="text-sm font-medium truncate">{source.name}</span>
                </div>
                 <div className={`w-5 h-5 flex items-center justify-center rounded-full border-2 transition-colors ${isDocumentViewActive ? 'border-blue-500 bg-blue-500' : 'border-gray-500'}`}>
                    {isDocumentViewActive && <div className="w-2 h-2 bg-gray-900 rounded-full"></div>}
                </div>
            </div>
        )}
      </div>
    </div>
  );
};

// Document Viewer Panel Component using PDF.js
interface DocumentViewerPanelProps {
    source: Source;
}
const DocumentViewerPanel: React.FC<DocumentViewerPanelProps> = ({ source }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [pdfDoc, setPdfDoc] = useState<any | null>(null);
    const [pageNum, setPageNum] = useState(1);
    const [numPages, setNumPages] = useState(0);
    const [isRendering, setIsRendering] = useState(false);
    const [isInitialScaleSet, setIsInitialScaleSet] = useState(false);
    const [scale, setScale] = useState(1.0);
    const [error, setError] = useState<string | null>(null);

    // Effect to load the PDF document from the source data
    useEffect(() => {
        setIsInitialScaleSet(false); // Reset scale flag on new document
        setPdfDoc(null);

        const loadPdf = async () => {
            if (!source?.fileDataUrl) return;

            const pdfjsLib = (window as any).pdfjsLib;
            if (!pdfjsLib) {
                setError("PDF.js library is not loaded.");
                return;
            }
            
            pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js`;
            
            try {
                const pdfData = atob(source.fileDataUrl.split(',')[1]);
                const pdfBytes = new Uint8Array(pdfData.length).map((_, i) => pdfData.charCodeAt(i));
                const loadingTask = pdfjsLib.getDocument({ data: pdfBytes });
                const doc = await loadingTask.promise;
                setPdfDoc(doc);
                setNumPages(doc.numPages);
                setPageNum(1);
                setError(null);
            } catch (err) {
                console.error('Error loading PDF:', err);
                setError("Failed to load PDF. The file might be corrupted.");
                setPdfDoc(null);
            }
        };

        loadPdf();
    }, [source]);

    const renderPage = useCallback(async (doc: any, num: number, currentScale: number) => {
        setIsRendering(true);
        try {
            const page = await doc.getPage(num);
            const canvas = canvasRef.current;
            if (!canvas) return;
            
            const viewport = page.getViewport({ scale: currentScale });
            const context = canvas.getContext('2d');
            if (!context) return;
            
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            // Force a white background to prevent dark theme rendering issues
            context.fillStyle = 'white';
            context.fillRect(0, 0, canvas.width, canvas.height);

            const renderContext = {
                canvasContext: context,
                viewport: viewport,
                renderInteractiveForms: false,
                background: 'rgba(255,255,255,1)', // Explicitly set background
            };
            await page.render(renderContext).promise;
        } catch(err) {
            console.error("Failed to render page", err);
        } finally {
            setIsRendering(false);
        }
    }, []);

    // Effect for auto-scaling and handling container resize.
    useEffect(() => {
        if (!pdfDoc || !containerRef.current) return;
        const container = containerRef.current;

        const calculateAndSetScale = () => {
            if (pdfDoc.getPage) {
                pdfDoc.getPage(1).then((page: any) => {
                    if (!containerRef.current) return;
                    const viewport = page.getViewport({ scale: 1 });
                    const newScale = Math.min(
                        containerRef.current.clientWidth / viewport.width,
                        containerRef.current.clientHeight / viewport.height
                    ) * 0.95; // 5% padding
                    setScale(newScale);
                    setIsInitialScaleSet(true); // Signal that the initial scale is set
                });
            }
        };
        
        // Use a ResizeObserver to rescale when the container size changes
        const observer = new ResizeObserver(calculateAndSetScale);
        observer.observe(container);
        
        return () => {
             if (container) {
                observer.unobserve(container);
            }
        };
    }, [pdfDoc]);


    // Effect to render a page when ready
    useEffect(() => {
        if (pdfDoc && isInitialScaleSet) {
            renderPage(pdfDoc, pageNum, scale);
        }
    }, [pdfDoc, pageNum, scale, isInitialScaleSet, renderPage]);
    
    const goToPrevPage = () => setPageNum(prev => Math.max(1, prev - 1));
    const goToNextPage = () => setPageNum(prev => Math.min(numPages, prev + 1));
    const zoomIn = () => setScale(prev => prev + 0.1);
    const zoomOut = () => setScale(prev => Math.max(0.1, prev - 0.1));

    return (
        <div className="flex flex-col bg-gray-800 h-full rounded-lg border border-gray-700">
            <PanelHeader title="Document Viewer" />
            {pdfDoc && (
                <div className="flex items-center justify-center p-2 bg-gray-900/90 border-b border-gray-700 gap-4 text-sm sticky top-0 z-10">
                    <button onClick={goToPrevPage} disabled={pageNum <= 1 || isRendering} className="px-3 py-1 rounded disabled:opacity-50 hover:bg-gray-700 transition-colors">Previous</button>
                    <span className="font-mono">Page {pageNum} of {numPages}</span>
                    <button onClick={goToNextPage} disabled={pageNum >= numPages || isRendering} className="px-3 py-1 rounded disabled:opacity-50 hover:bg-gray-700 transition-colors">Next</button>
                    <div className="ml-6 border-l border-gray-600 pl-4 flex items-center gap-2">
                        <button onClick={zoomOut} disabled={isRendering} className="px-3 py-1 rounded disabled:opacity-50 hover:bg-gray-700 transition-colors">Zoom -</button>
                        <span className="font-mono text-xs w-12 text-center">{(scale * 100).toFixed(0)}%</span>
                        <button onClick={zoomIn} disabled={isRendering} className="px-3 py-1 rounded disabled:opacity-50 hover:bg-gray-700 transition-colors">Zoom +</button>
                    </div>
                </div>
            )}
            <div ref={containerRef} className="flex-1 overflow-auto p-4 flex justify-center items-center bg-gray-900/50">
                <div className='relative'>
                    {(!isInitialScaleSet || isRendering) && (
                        <div className="absolute inset-0 flex items-center justify-center text-gray-400">
                             <p>{error || (pdfDoc ? "Rendering page..." : "Loading document...")}</p>
                        </div>
                    )}
                    <canvas ref={canvasRef} className={`rounded-md shadow-lg ${isRendering || !isInitialScaleSet ? 'opacity-20' : 'opacity-100'} transition-opacity`}></canvas>
                </div>
            </div>
        </div>
    );
};

// This code runs in a separate thread and is responsible for processing audio data.
const audioWorkletProcessorCode = `
class StreamingAudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.chunks = [];
        this.streamEnded = false;
        
        this.port.onmessage = (event) => {
            if (event.data === null) {
                this.streamEnded = true;
            } else if (event.data instanceof Float32Array) {
                this.chunks.push(event.data);
            }
        };
    }

    process(inputs, outputs, parameters) {
        const outputChannel = outputs[0][0];
        const bufferSize = outputChannel.length;
        let samplesProcessed = 0;

        while (samplesProcessed < bufferSize && this.chunks.length > 0) {
            const chunk = this.chunks[0];
            const remainingInChunk = chunk.length;
            const toProcess = Math.min(bufferSize - samplesProcessed, remainingInChunk);

            outputChannel.set(chunk.subarray(0, toProcess), samplesProcessed);
            
            samplesProcessed += toProcess;

            if (toProcess < remainingInChunk) {
                this.chunks[0] = chunk.subarray(toProcess);
            } else {
                this.chunks.shift();
            }
        }

        if (samplesProcessed < bufferSize) {
            outputChannel.fill(0, samplesProcessed);
        }
        
        if (this.streamEnded && this.chunks.length === 0) {
            this.port.postMessage('playback-finished');
            this.streamEnded = false; 
        }

        return true;
    }
}

registerProcessor('streaming-audio-processor', StreamingAudioProcessor);
`;

// Splits text into sentences for chunked TTS streaming
const splitIntoSentences = (text: string): string[] => {
    // This regex matches sentences ending in ., ?, or !, and handles the end of the string.
    const sentences = text.match(/[^.!?]+[.!?]\s*|[^.!?]+$/g);
    return sentences ? sentences.map(s => s.trim()).filter(s => s.length > 0) : [];
};

// Chat Panel Component
interface ChatPanelProps {
    chatHistory: ChatMessage[];
    onSendMessage: (message: string) => void;
    onPinMessage: (messageId: string, question: string, answer: string) => void;
    isLoading: boolean;
    source: Source | null;
    isVoiceMode: boolean;
    toggleVoiceMode: () => void;
    isListening: boolean;
    notebookName: string | null;
}
const ChatPanel: React.FC<ChatPanelProps> = ({ chatHistory, onSendMessage, onPinMessage, isLoading, source, isVoiceMode, toggleVoiceMode, isListening, notebookName }) => {
    const [input, setInput] = useState('');
    const chatEndRef = useRef<HTMLDivElement>(null);
    const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
    
    // Refs for AudioWorklet-based streaming playback
    const audioContextRef = useRef<AudioContext | null>(null);
    const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatHistory]);

    const stopPlayback = useCallback(() => {
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
        if (audioWorkletNodeRef.current) {
            audioWorkletNodeRef.current.port.onmessage = null;
            audioWorkletNodeRef.current.disconnect();
            audioWorkletNodeRef.current = null;
        }
        setPlayingMessageId(null);
    }, []);

    // Cleanup audio resources on component unmount
    useEffect(() => {
        return () => {
            stopPlayback();
            if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
                audioContextRef.current.close();
            }
        };
    }, [stopPlayback]);

    const handleSend = () => {
        if (input.trim() && !isLoading) {
            onSendMessage(input);
            setInput('');
        }
    };

    const handleToggleReadAloud = async ({ id, text }: { id: string, text: string }) => {
        if (playingMessageId === id) {
            stopPlayback();
            return;
        }

        stopPlayback(); // Stop any currently playing audio

        const controller = new AbortController();
        abortControllerRef.current = controller;
        setPlayingMessageId(id);

        try {
            if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
                audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
            }
            const audioContext = audioContextRef.current;
            if (audioContext.state === 'suspended') {
                await audioContext.resume();
            }

            const workletBlob = new Blob([audioWorkletProcessorCode], { type: 'application/javascript' });
            const workletURL = URL.createObjectURL(workletBlob);
            await audioContext.audioWorklet.addModule(workletURL);
            
            const workletNode = new AudioWorkletNode(audioContext, 'streaming-audio-processor');
            workletNode.port.onmessage = (event) => {
                if (event.data === 'playback-finished') {
                    stopPlayback();
                }
            };
            workletNode.connect(audioContext.destination);
            audioWorkletNodeRef.current = workletNode;
            
            const sentences = splitIntoSentences(text);

            for (const sentence of sentences) {
                if (controller.signal.aborted) break;
                
                await readAloudStream(
                    sentence,
                    (audioChunk) => { // onAudioChunk callback
                        if (controller.signal.aborted || !audioWorkletNodeRef.current) return;
                        
                        const pcm16 = new Int16Array(audioChunk.buffer, audioChunk.byteOffset, audioChunk.byteLength / 2);
                        const float32 = new Float32Array(pcm16.length);
                        for (let i = 0; i < pcm16.length; i++) {
                            float32[i] = pcm16[i] / 32768.0;
                        }
                        
                        audioWorkletNodeRef.current.port.postMessage(float32);
                    },
                    controller.signal
                );
            }

        } catch (error) {
            if ((error as Error).name !== 'AbortError') {
                console.error("Failed to stream audio", error);
                alert("Sorry, could not generate audio for this message.");
                stopPlayback();
            }
        } finally {
            if (!controller.signal.aborted && audioWorkletNodeRef.current) {
                // Signal to the worklet that the stream has ended.
                audioWorkletNodeRef.current.port.postMessage(null);
            }
        }
    };
    
    const chatInputArea = isVoiceMode ? (
         <div className="flex items-center justify-center p-4 bg-gray-900 rounded-b-lg border-t border-gray-700 h-[120px]">
            <button onClick={toggleVoiceMode} className={`flex items-center justify-center w-20 h-20 rounded-full transition-colors ${isListening ? 'bg-red-500 hover:bg-red-600 animate-pulse' : 'bg-blue-600 hover:bg-blue-700'}`}>
                {isListening ? <StopCircleIcon className="w-10 h-10 text-white" /> : <MicrophoneIcon className="w-10 h-10 text-white" />}
            </button>
         </div>
    ) : (
        <div className="p-4 bg-gray-900 rounded-b-lg border-t border-gray-700">
        <div className="relative">
            <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Start typing..."
            className="w-full bg-gray-700 rounded-full py-3 pl-5 pr-20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isLoading || !source}
            />
            <div className="absolute inset-y-0 right-0 flex items-center pr-2">
            <button onClick={toggleVoiceMode} className="p-2 rounded-full hover:bg-gray-600 transition-colors">
                <MicrophoneIcon className="w-6 h-6 text-gray-400" />
            </button>
            <button onClick={handleSend} disabled={isLoading || !source || !input.trim()} className="p-2 rounded-full bg-gray-600 hover:bg-gray-500 disabled:bg-gray-800 disabled:cursor-not-allowed transition-colors ml-1">
                <ArrowUpCircleIcon className={`w-7 h-7 ${input.trim() ? 'text-white' : 'text-gray-500'}`} />
            </button>
            </div>
        </div>
        </div>
    );

    return (
        <div className="flex flex-col bg-gray-800 h-full rounded-lg border border-gray-700">
        <PanelHeader title="Chat" />
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {!source && (
                 <div className="text-center text-gray-400">Create a new notebook or select an existing one to begin.</div>
            )}
            {chatHistory.map((msg, index) => (
            <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-xl rounded-lg px-4 py-3 ${msg.sender === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-700'}`}>
                {msg.sender === 'ai' && index === 0 && notebookName && (
                     <>
                        <div className="flex items-center gap-2 mb-2">
                            <ChartBarIcon className="w-8 h-8"/>
                            <h3 className="text-xl font-bold">{notebookName}</h3>
                        </div>
                        <p className="text-sm text-gray-400 mb-2">1 source</p>
                    </>
                )}
                <p className="text-base">{msg.text}</p>
                 {msg.sender === 'ai' && (
                    <div className="flex items-center gap-2 mt-4">
                        {index === 0 ? (
                            <button onClick={() => handleToggleReadAloud({ id: msg.id, text: msg.text })} className="flex items-center gap-2 text-sm bg-gray-600/50 hover:bg-gray-600 px-3 py-1 rounded-full transition-colors">
                                <SpeakerWaveIcon className="w-4 h-4" /> {playingMessageId === msg.id ? 'Stop' : 'Read'}
                            </button>
                        ) : (
                            <>
                                {!msg.isPinned ? (
                                    <button onClick={() => onPinMessage(msg.id, msg.question!, msg.text)} className="flex items-center gap-2 text-sm bg-gray-600/50 hover:bg-gray-600 px-3 py-1 rounded-full transition-colors">
                                        <PinIcon className="w-4 h-4" /> Save to note
                                    </button>
                                ) : (
                                    <span className="flex items-center gap-1 text-xs text-green-400">
                                        <CheckIcon className="w-3 h-3"/> Pinned!
                                    </span>
                                )}
                                <button onClick={() => handleToggleReadAloud({ id: msg.id, text: msg.text })} className="flex items-center gap-2 text-sm bg-gray-600/50 hover:bg-gray-600 px-3 py-1 rounded-full transition-colors">
                                    <SpeakerWaveIcon className="w-4 h-4" /> {playingMessageId === msg.id ? 'Stop' : 'Read'}
                                </button>
                            </>
                        )}
                    </div>
                )}
                </div>
            </div>
            ))}
            {isLoading && <div className="text-center text-gray-400">Gemini is thinking...</div>}
            <div ref={chatEndRef} />
        </div>
        {chatInputArea}
        </div>
    );
};


// Right Panel Component
interface RightPanelProps {
    savedNotes: SavedNote[];
    notebooks: Notebook[];
    activeNotebookId: string | null;
    onNewNotebook: () => void;
    onSelectNotebook: (id: string) => void;
    onRenameNotebook: (id: string, newName: string) => void;
    onDeleteNotebook: (id: string) => void;
    onSaveNotebooks: () => void;
    onLoadNotebooks: (file: File) => void;
}
const RightPanel: React.FC<RightPanelProps> = (props) => {
    const [activeTab, setActiveTab] = useState<'notes' | 'notebooks'>(props.activeNotebookId ? 'notes' : 'notebooks');

    useEffect(() => {
        // This effect correctly switches to notes when a notebook becomes active,
        // but doesn't prevent switching back to the notebooks list.
        if (props.activeNotebookId) {
            setActiveTab('notes');
        }
    }, [props.activeNotebookId]);

    return (
        <div className="flex flex-col bg-gray-900/50 h-full rounded-lg border border-gray-700">
            <div className="flex border-b border-gray-700">
                <button
                    onClick={() => setActiveTab('notes')}
                    disabled={!props.activeNotebookId}
                    className={`flex-1 p-3 font-semibold text-sm transition-colors ${activeTab === 'notes' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-800/50'} disabled:text-gray-600 disabled:cursor-not-allowed`}
                >
                    Saved Notes
                </button>
                <button
                    onClick={() => setActiveTab('notebooks')}
                    className={`flex-1 p-3 font-semibold text-sm transition-colors ${activeTab === 'notebooks' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-800/50'}`}
                >
                    Notebooks
                </button>
            </div>
            {activeTab === 'notes' ? (
                <SavedNotesList items={props.savedNotes} />
            ) : (
                <NotebooksList {...props} />
            )}
        </div>
    );
};

// Saved Notes List (Sub-component of RightPanel)
const SavedNotesList: React.FC<{ items: SavedNote[] }> = ({ items }) => (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {items.length === 0 && (
            <div className="text-center text-gray-500 pt-10">Pin insights from your chat to see them here.</div>
        )}
        {items.map(item => (
            <div key={item.id} className="bg-gray-800 p-4 rounded-lg">
                <p className="font-semibold mb-1">{item.question}</p>
                <p className="text-sm text-gray-300 mb-2">{item.answer}</p>
                <div className="text-xs text-gray-500 flex items-center gap-2">
                    <PdfIcon className="w-3 h-3"/>
                    <span>{item.sourceName} &bull; {item.timestamp}</span>
                </div>
            </div>
        ))}
    </div>
);

// Notebooks List (Sub-component of RightPanel)
const NotebooksList: React.FC<RightPanelProps> = ({ notebooks, activeNotebookId, onNewNotebook, onSelectNotebook, onRenameNotebook, onDeleteNotebook, onSaveNotebooks, onLoadNotebooks }) => {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState('');
    const renameInputRef = useRef<HTMLInputElement>(null);
    const loadFileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (editingId && renameInputRef.current) {
            renameInputRef.current.focus();
        }
    }, [editingId]);

    const handleStartRename = (id: string, name: string) => {
        setEditingId(id);
        setEditingName(name);
    };

    const handleRename = () => {
        if (editingId && editingName.trim()) {
            onRenameNotebook(editingId, editingName.trim());
        }
        setEditingId(null);
        setEditingName('');
    };

    const handleLoadClick = () => {
        if (loadFileInputRef.current) {
            loadFileInputRef.current.value = ""; // Reset for re-uploads
            loadFileInputRef.current.click();
        }
    };

    const handleFileLoad = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            if (file.name.toLowerCase().endsWith('.json')) {
                onLoadNotebooks(file);
            } else {
                alert('Please upload a valid JSON file (with a .json extension).');
            }
        }
    };
    
    return (
         <div className="flex-1 flex flex-col">
            <div className='p-4 space-y-2'>
                <button onClick={onNewNotebook} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg transition-colors">
                    + New Notebook
                </button>
                <div className='flex gap-2 pt-2'>
                    <input
                        type="file"
                        ref={loadFileInputRef}
                        onChange={handleFileLoad}
                        className="hidden"
                    />
                    <button onClick={onSaveNotebooks} className="flex-1 flex items-center justify-center gap-2 bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-lg transition-colors text-sm">
                        <ArrowDownTrayIcon className="w-4 h-4" /> Save All to File
                    </button>
                    <button onClick={handleLoadClick} className="flex-1 flex items-center justify-center gap-2 bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-lg transition-colors text-sm">
                       <ArrowUpTrayIcon className="w-4 h-4" /> Load from File
                    </button>
                </div>
            </div>
            <div className="overflow-y-auto p-4 pt-0 space-y-2">
                {notebooks.length === 0 && <p className="text-center text-gray-500 text-sm">No notebooks yet.</p>}
                {notebooks.map(nb => (
                     <div key={nb.id} onClick={() => editingId !== nb.id && onSelectNotebook(nb.id)} className={`group p-3 rounded-lg cursor-pointer transition-colors ${activeNotebookId === nb.id ? 'bg-blue-900/50' : 'hover:bg-gray-800/70'}`}>
                        <div className="flex items-center justify-between">
                             {editingId === nb.id ? (
                                <input
                                    ref={renameInputRef}
                                    type="text"
                                    value={editingName}
                                    onChange={(e) => setEditingName(e.target.value)}
                                    onBlur={handleRename}
                                    onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                                    className="bg-gray-700 text-white text-sm p-1 rounded w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                             ) : (
                                <div>
                                    <p className="font-semibold text-sm truncate">{nb.name}</p>
                                    <p className="text-xs text-gray-400">{nb.createdAt}</p>
                                </div>
                             )}
                            <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={(e) => {e.stopPropagation(); handleStartRename(nb.id, nb.name)}} className="p-1 text-gray-400 hover:text-white"><PencilIcon className="w-4 h-4" /></button>
                                <button onClick={(e) => {e.stopPropagation(); onDeleteNotebook(nb.id)}} className="p-1 text-gray-400 hover:text-red-400"><TrashIcon className="w-4 h-4" /></button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

type LiveSession = Awaited<ReturnType<typeof createLiveSession>>;
interface Workspace {
    notebooks: Notebook[];
    activeNotebookId: string | null;
}

// Main App Component
const App: React.FC = () => {
    const [workspace, setWorkspace] = useState<Workspace>({ notebooks: [], activeNotebookId: null });
    const [isLoading, setIsLoading] = useState(false);
    const [isVoiceMode, setIsVoiceMode] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const [isDocumentViewActive, setIsDocumentViewActive] = useState(false);
    
    const { notebooks, activeNotebookId } = workspace;
    const activeNotebook = notebooks.find(n => n.id === activeNotebookId) || null;
    
    useEffect(() => {
        try {
            const savedData = localStorage.getItem('notebook_workspace');
            if (savedData) {
                const loadedWorkspace: Workspace = JSON.parse(savedData);
                // Basic validation
                if (loadedWorkspace && Array.isArray(loadedWorkspace.notebooks)) {
                   setWorkspace(loadedWorkspace);
                }
            }
        } catch (error) {
            console.error("Failed to load from localStorage", error);
        }
    }, []);

    useEffect(() => {
        try {
            localStorage.setItem('notebook_workspace', JSON.stringify(workspace));
        } catch (error) {
            console.error("Failed to save to localStorage", error);
        }
    }, [workspace]);


    const handleNewNotebook = () => {
        const timestamp = new Date();
        const newNotebookTemplate: Notebook = {
            id: crypto.randomUUID(),
            name: `Untitled ${timestamp.toLocaleTimeString()}`,
            source: null!, 
            chatHistory: [],
            savedNotes: [],
            createdAt: timestamp.toLocaleDateString()
        };
        setWorkspace(prev => ({
            notebooks: [newNotebookTemplate, ...prev.notebooks],
            activeNotebookId: newNotebookTemplate.id
        }));
        setIsDocumentViewActive(false);
    };

    const handleSelectNotebook = (id: string) => {
        setWorkspace(prev => ({ ...prev, activeNotebookId: id }));
        setIsDocumentViewActive(false);
    };
    const handleRenameNotebook = (id: string, newName: string) => {
        setWorkspace(prev => ({
            ...prev,
            notebooks: prev.notebooks.map(n => n.id === id ? { ...n, name: newName } : n)
        }));
    };
    const handleDeleteNotebook = (id: string) => {
        if (window.confirm("Are you sure you want to delete this notebook?")) {
            setWorkspace(prev => {
                const remainingNotebooks = prev.notebooks.filter(n => n.id !== id);
                const newActiveId = prev.activeNotebookId === id
                    ? (remainingNotebooks.length > 0 ? remainingNotebooks[0].id : null)
                    : prev.activeNotebookId;
                
                if(prev.activeNotebookId === id) {
                    setIsDocumentViewActive(false);
                }
                return { notebooks: remainingNotebooks, activeNotebookId: newActiveId };
            });
        }
    };
    
    const handleFileUpload = async (file: File) => {
        let isNewNotebook = false;
        let notebookToUpdateId = activeNotebookId;

        // If there's no active notebook, or the active one already has a source, create one automatically.
        if (!notebookToUpdateId || activeNotebook?.source) {
            isNewNotebook = true;
            const newNotebook: Notebook = {
                id: crypto.randomUUID(),
                name: "Processing PDF...",
                source: null!,
                chatHistory: [],
                savedNotes: [],
                createdAt: new Date().toLocaleDateString(),
            };
            setWorkspace(prev => ({
                notebooks: [newNotebook, ...prev.notebooks],
                activeNotebookId: newNotebook.id
            }));
            notebookToUpdateId = newNotebook.id;
        }

        setIsLoading(true);
        setIsDocumentViewActive(false);
        try {
            const fileDataUrl = await fileToBase64(file);
            const pdfjsLib = (window as any).pdfjsLib;
            if (!pdfjsLib) throw new Error("PDF.js library not loaded.");
            
            pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js`;
            const loadingTask = pdfjsLib.getDocument(fileDataUrl);
            const doc = await loadingTask.promise;
            let extractedText = '';
            for (let i = 1; i <= doc.numPages; i++) {
                const page = await doc.getPage(i);
                const textContent = await page.getTextContent();
                extractedText += textContent.items.map((item: any) => item.str).join(' ') + '\n';
            }

            const source: Source = {
                id: crypto.randomUUID(),
                name: file.name,
                content: extractedText,
                fileDataUrl: fileDataUrl,
            };

            const summary = await getSummary(source.content);
            const title = await getTitleFromSummary(summary);
            
            setWorkspace(prev => ({
                ...prev,
                notebooks: prev.notebooks.map(n => {
                    if (n.id === notebookToUpdateId) {
                        return {
                            ...n,
                            name: title,
                            source: source,
                            chatHistory: [{ id: crypto.randomUUID(), sender: 'ai', text: summary }],
                        }
                    }
                    return n;
                })
            }));

        } catch (error) {
            console.error("Error processing PDF:", error);
            alert("There was an error processing the PDF. It may be corrupted.");
            // Clean up the automatically created notebook on failure
             if (isNewNotebook) {
                setWorkspace(prev => {
                    const remainingNotebooks = prev.notebooks.filter(n => n.id !== notebookToUpdateId);
                    const newActiveId = prev.activeNotebookId === notebookToUpdateId
                        ? (notebooks.length > 1 ? notebooks[0].id : null)
                        : prev.activeNotebookId;
                    return { notebooks: remainingNotebooks, activeNotebookId: newActiveId };
                });
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handleToggleDocumentView = () => {
        if (activeNotebook?.source) {
            setIsDocumentViewActive(prev => !prev);
        }
    };

    const handleSendMessage = async (message: string) => {
        if (!activeNotebook || !activeNotebook.source) return;
        
        const userMessage: ChatMessage = { id: crypto.randomUUID(), sender: 'user', text: message };
        
        setWorkspace(prev => ({
            ...prev,
            notebooks: prev.notebooks.map(n => 
                n.id === activeNotebookId ? { ...n, chatHistory: [...n.chatHistory, userMessage] } : n
            )
        }));

        setIsLoading(true);
        
        const answer = await getAnswer(message, activeNotebook.source.content);
        const aiMessage: ChatMessage = { id: crypto.randomUUID(), sender: 'ai', text: answer, question: message };
        
        setWorkspace(prev => ({
            ...prev,
            notebooks: prev.notebooks.map(n =>
                n.id === activeNotebookId ? { ...n, chatHistory: [...n.chatHistory, aiMessage] } : n
            )
        }));
        setIsLoading(false);
    };

    const handlePinMessage = (messageId: string, question: string, answer: string) => {
        if (!activeNotebook || !activeNotebook.source) return;
        
        const newNote: SavedNote = {
            id: messageId,
            question,
            answer,
            sourceName: activeNotebook.source.name,
            timestamp: new Date().toLocaleDateString()
        };
        
        setWorkspace(prev => ({
            ...prev,
            notebooks: prev.notebooks.map(n => {
                if (n.id === activeNotebookId) {
                    const updatedHistory = n.chatHistory.map(msg => msg.id === messageId ? {...msg, isPinned: true} : msg);
                    const noteExists = n.savedNotes.some(note => note.id === messageId);
                    const updatedNotes = noteExists ? n.savedNotes : [newNote, ...n.savedNotes];
                    return { ...n, chatHistory: updatedHistory, savedNotes: updatedNotes };
                }
                return n;
            })
        }));
    };
    
    const liveSessionRef = useRef<LiveSession | null>(null);
    const inputAudioContextRef = useRef<AudioContext | null>(null);
    const outputAudioContextRef = useRef<AudioContext | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const audioSourceNodesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

    const stopVoiceMode = useCallback(() => {
        setIsListening(false);
        setIsVoiceMode(false);

        liveSessionRef.current?.close();
        liveSessionRef.current = null;
        
        scriptProcessorRef.current?.disconnect();
        scriptProcessorRef.current = null;

        mediaStreamSourceRef.current?.disconnect();
        mediaStreamSourceRef.current = null;

        audioSourceNodesRef.current.forEach(source => source.stop());
        audioSourceNodesRef.current.clear();
    }, []);

    const startVoiceMode = useCallback(async () => {
        if (!activeNotebook?.source?.content) {
            alert("Please add a document to a notebook before starting voice mode.");
            return;
        }

        setIsVoiceMode(true);
        setIsListening(true);
        let nextStartTime = 0;

        if (!outputAudioContextRef.current || outputAudioContextRef.current.state === 'closed') {
            outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        }
        if (!inputAudioContextRef.current || inputAudioContextRef.current.state === 'closed') {
            inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            const sessionPromise = createLiveSession(
                async (message: LiveServerMessage) => {
                    const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                    if (base64Audio && outputAudioContextRef.current) {
                        const outputCtx = outputAudioContextRef.current;
                        if(outputCtx.state === 'suspended') await outputCtx.resume();
                        
                        nextStartTime = Math.max(nextStartTime, outputCtx.currentTime);
                        const audioData = decode(base64Audio);
                        const audioBuffer = await decodeAudioData(audioData, outputCtx, 24000, 1);
                        
                        const sourceNode = outputCtx.createBufferSource();
                        sourceNode.buffer = audioBuffer;
                        sourceNode.connect(outputCtx.destination);
                        
                        sourceNode.onended = () => audioSourceNodesRef.current.delete(sourceNode);
                        sourceNode.start(nextStartTime);
                        nextStartTime += audioBuffer.duration;
                        audioSourceNodesRef.current.add(sourceNode);
                    }
                },
                (error) => { console.error("Live session error:", error); stopVoiceMode(); },
                () => { console.log("Live session closed."); stopVoiceMode(); }
            );

            liveSessionRef.current = await sessionPromise;
            liveSessionRef.current.sendRealtimeInput({
                text: `CONTEXT: The user has uploaded a document with the following content. Base your answers on this. Do not mention the context in your response. CONTENT: ${activeNotebook.source.content}`
            });
            
            const inputCtx = inputAudioContextRef.current;
            if (inputCtx) {
                mediaStreamSourceRef.current = inputCtx.createMediaStreamSource(stream);
                scriptProcessorRef.current = inputCtx.createScriptProcessor(4096, 1, 1);
                
                scriptProcessorRef.current.onaudioprocess = (e) => {
                    const inputData = e.inputBuffer.getChannelData(0);
                    liveSessionRef.current?.sendRealtimeInput({ media: createAudioBlob(inputData) });
                };

                mediaStreamSourceRef.current.connect(scriptProcessorRef.current);
                scriptProcessorRef.current.connect(inputCtx.destination);
            }

        } catch (error) {
            console.error("Failed to start voice mode:", error);
            alert("Could not access microphone. Please check permissions.");
            stopVoiceMode();
        }
    }, [activeNotebook, stopVoiceMode]);
    
    const toggleVoiceMode = () => { isVoiceMode ? stopVoiceMode() : startVoiceMode(); };
    useEffect(() => () => stopVoiceMode(), [stopVoiceMode]);

    const handleSaveNotebooks = () => {
        if (notebooks.length === 0) {
            alert("There are no notebooks to save.");
            return;
        }
        try {
            const pdfDataMissing = workspace.notebooks.some(n => n.source && (!n.source.fileDataUrl || n.source.fileDataUrl.length < 100));
            if (pdfDataMissing) {
                alert("Error: Some PDF data appears to be missing. Cannot save correctly. Please try reloading the page and your file.");
                return;
            }

            const dataStr = JSON.stringify(workspace, null, 2); 
            const dataBlob = new Blob([dataStr], { type: "application/json" });
            const url = URL.createObjectURL(dataBlob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `notebooks-export-${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error("Failed to save notebooks:", error);
            alert("An error occurred while trying to save the notebooks.");
        }
    };

    const handleLoadNotebooks = (file: File) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const content = event.target?.result;
                if (typeof content !== 'string') throw new Error("File content is not valid.");
                
                const loadedWorkspace: Workspace = JSON.parse(content);
                
                if (loadedWorkspace && Array.isArray(loadedWorkspace.notebooks) && typeof loadedWorkspace.activeNotebookId !== 'undefined') {
                    setWorkspace(loadedWorkspace);
                    setIsDocumentViewActive(false);
                } else {
                    throw new Error("JSON file is not in the correct format. It should be an object with a 'notebooks' array and an 'activeNotebookId'.");
                }
            } catch (error) {
                alert(`Error loading file: ${(error as Error).message}`);
            }
        };
        reader.onerror = () => {
            alert("Failed to read the selected file.");
        };
        reader.readAsText(file);
    };

    return (
        <div className="h-screen w-screen p-4 bg-gray-800 text-gray-200">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-full">
            <div className="lg:col-span-3 h-full">
                <SourcesPanel 
                    source={activeNotebook?.source || null} 
                    onFileUpload={handleFileUpload}
                    isLoading={isLoading}
                    hasActiveNotebook={!!activeNotebook}
                    isDocumentViewActive={isDocumentViewActive}
                    onToggleDocumentView={handleToggleDocumentView}
                />
            </div>
            <div className="lg:col-span-6 h-full">
                {isDocumentViewActive && activeNotebook?.source ? (
                    <DocumentViewerPanel source={activeNotebook.source} />
                ) : (
                    <ChatPanel
                        chatHistory={activeNotebook?.chatHistory || []}
                        onSendMessage={handleSendMessage}
                        onPinMessage={handlePinMessage}
                        isLoading={isLoading}
                        source={activeNotebook?.source || null}
                        isVoiceMode={isVoiceMode}
                        toggleVoiceMode={toggleVoiceMode}
                        isListening={isListening}
                        notebookName={activeNotebook?.name || null}
                    />
                )}
            </div>
            <div className="lg:col-span-3 h-full">
                 <RightPanel
                    savedNotes={activeNotebook?.savedNotes || []}
                    notebooks={notebooks}
                    activeNotebookId={activeNotebookId}
                    onNewNotebook={handleNewNotebook}
                    onSelectNotebook={handleSelectNotebook}
                    onRenameNotebook={handleRenameNotebook}
                    onDeleteNotebook={handleDeleteNotebook}
                    onSaveNotebooks={handleSaveNotebooks}
                    onLoadNotebooks={handleLoadNotebooks}
                />
            </div>
        </div>
    </div>
    );
};

export default App;
