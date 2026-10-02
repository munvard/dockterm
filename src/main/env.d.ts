/// <reference types="electron-vite/node" />
declare module '*.cjs?raw' {
  const content: string
  export default content
}
