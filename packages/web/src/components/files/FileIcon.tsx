import {
  Image as ImageIcon,
  Film,
  Music,
  FileText,
  FileSpreadsheet,
  Presentation,
  Archive,
  File as FileGeneric,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../../lib/utils';

interface FileIconProps {
  mimeType: string | null | undefined;
  className?: string;
}

interface FileTypeInfo {
  Icon: LucideIcon;
  color: string;
  name: string;
}

const DEFAULT_TYPE: FileTypeInfo = {
  Icon: FileGeneric,
  color: 'text-slate-500',
  name: 'File',
};

const GOOGLE_NATIVE_TYPES: Record<string, FileTypeInfo> = {
  'application/vnd.google-apps.document':     { Icon: FileText,        color: 'text-blue-500',    name: 'Google Docs' },
  'application/vnd.google-apps.spreadsheet':  { Icon: FileSpreadsheet, color: 'text-green-600',  name: 'Google Sheets' },
  'application/vnd.google-apps.presentation': { Icon: Presentation,    color: 'text-amber-500',  name: 'Google Slides' },
  'application/vnd.google-apps.form':         { Icon: FileText,        color: 'text-purple-500', name: 'Google Forms' },
  'application/vnd.google-apps.drawing':      { Icon: ImageIcon,       color: 'text-red-500',    name: 'Google Drawing' },
  'application/vnd.google-apps.jam':          { Icon: Presentation,    color: 'text-amber-500',  name: 'Google Jamboard' },
  'application/vnd.google-apps.script':       { Icon: FileText,        color: 'text-yellow-600', name: 'Google Apps Script' },
  'application/vnd.google-apps.site':         { Icon: FileText,        color: 'text-teal-600',   name: 'Google Sites' },
  'application/vnd.google-apps.shortcut':     { Icon: FileText,        color: 'text-slate-500',  name: 'Shortcut' },
  'application/vnd.google-apps.photo':        { Icon: ImageIcon,       color: 'text-purple-500', name: 'Photo' },
};

function resolveFileType(mimeType: string | null | undefined): FileTypeInfo {
  if (!mimeType) return DEFAULT_TYPE;
  if (GOOGLE_NATIVE_TYPES[mimeType]) return GOOGLE_NATIVE_TYPES[mimeType];
  if (mimeType.startsWith('image/'))  return { Icon: ImageIcon,      color: 'text-purple-500', name: 'Image' };
  if (mimeType.startsWith('video/'))  return { Icon: Film,           color: 'text-pink-500',   name: 'Video' };
  if (mimeType.startsWith('audio/'))  return { Icon: Music,          color: 'text-yellow-500', name: 'Audio' };
  if (mimeType.includes('pdf')) {
    return { Icon: FileText, color: 'text-red-500', name: 'PDF' };
  }
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv')) {
    return { Icon: FileSpreadsheet, color: 'text-green-600', name: 'Spreadsheet' };
  }
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) {
    return { Icon: Presentation, color: 'text-orange-500', name: 'Presentation' };
  }
  if (mimeType.includes('document') || mimeType.includes('word')) {
    return { Icon: FileText, color: 'text-blue-500', name: 'Document' };
  }
  if (mimeType.includes('zip') || mimeType.includes('compressed') || mimeType.includes('archive')) {
    return { Icon: Archive, color: 'text-amber-600', name: 'Archive' };
  }
  if (mimeType.startsWith('text/')) {
    return { Icon: FileText, color: 'text-blue-500', name: 'Text' };
  }
  return DEFAULT_TYPE;
}

export function FileIcon({ mimeType, className }: FileIconProps) {
  const { Icon, color } = resolveFileType(mimeType);
  return <Icon size="1em" className={cn(color, className, 'flex-shrink-0')} />;
}

export function getFileTypeName(mimeType: string | null | undefined): string {
  return resolveFileType(mimeType).name;
}
