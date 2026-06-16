import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import { buildMonacoTheme } from './monacoTheme'
import { useThemeStore } from '../../state/useThemeStore'

declare global {
  interface Window {
    MonacoEnvironment?: monaco.Environment
  }
}

// Workers are bundled locally by Vite — nothing is ever fetched from a CDN.
window.MonacoEnvironment = {
  getWorker(_workerId, label) {
    switch (label) {
      case 'json':
        return new JsonWorker()
      case 'css':
      case 'scss':
      case 'less':
        return new CssWorker()
      case 'html':
      case 'handlebars':
      case 'razor':
        return new HtmlWorker()
      case 'typescript':
      case 'javascript':
        return new TsWorker()
      default:
        return new EditorWorker()
    }
  }
}

// Defined from the current app theme so the editor exists before either editor
// component mounts; the components re-define + re-apply it when the theme changes.
monaco.editor.defineTheme('dockterm', buildMonacoTheme(useThemeStore.getState().theme))

export { monaco }
