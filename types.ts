
export interface Source {
  id: string;
  name: string;
  content: string; // The extracted text for Gemini
  fileDataUrl?: string; // Base64 encoded data URL for the PDF viewer - optional, loaded on demand or for import/export
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  isPinned?: boolean;
  question?: string; // If it's an AI answer, this holds the user's question
}

// Renamed from StudioItem
export interface SavedNote {
  id: string; // Corresponds to the ChatMessage id
  question: string;
  answer: string;
  sourceName: string;
  timestamp: string;
}

export interface Notebook {
  id:string;
  name: string;
  source: Source | null;
  chatHistory: ChatMessage[];
  savedNotes: SavedNote[];
  createdAt: string;
}
