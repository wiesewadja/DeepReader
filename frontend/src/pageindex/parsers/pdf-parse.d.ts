/**
 * Type declarations for pdf-parse
 */
declare module 'pdf-parse' {
  export interface PDFParseOptions {
    data: Uint8Array | Buffer;
  }

  export interface PDFTextResult {
    pages: Array<{
      text: string;
    }>;
  }

  export interface PDFInfoResult {
    info?: {
      Title?: string;
      [key: string]: any;
    };
    outline?: PDFOutlineItem[];
  }

  export interface PDFOutlineItem {
    title: string;
    dest?: string | any[];
    items?: PDFOutlineItem[];
  }

  interface PDFParseConstructor {
    new (options: PDFParseOptions): PDFParseInstance;
    (options: PDFParseOptions): PDFParseInstance;
  }

  interface PDFParseInstance {
    getText(): Promise<PDFTextResult>;
    getInfo(): Promise<PDFInfoResult>;
    destroy(): Promise<void>;
    doc: any;
  }

  const PDFParse: PDFParseConstructor;
  export default PDFParse;
}