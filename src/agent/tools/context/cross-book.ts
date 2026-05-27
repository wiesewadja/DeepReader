export interface CrossBookContext {
  booklistBookIds?: string[];
  crossBookMode?: boolean;
  bookshelfSummary?: string;
  indexedBooks?: { id: string; name: string }[];
}
