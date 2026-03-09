/**
 * Skill 类型定义
 */

export interface Skill {
  name: string;
  description: string;
  body: string;
  path: string;
  isDefault: boolean;
  keywords?: string[];
  bookTypes?: string[];
  meta?: {
    version?: string;
    author?: string;
    tags?: string[];
  };
}
