declare module 'nebulog' {
  interface Logger {
    info(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    debug(message: string, ...args: unknown[]): void;
  }
  export function make(options: { filename: string; level?: string }): Logger;
  const nebulog: { make: typeof make };
  export default nebulog;
}

declare module 'sanitize-html' {
  const sanitizeHtml: any;
  export = sanitizeHtml;
}

declare module 'html-entities' {
  const htmlEntities: any;
  export = htmlEntities;
}

declare module 'mailcomposer' {
  const mailcomposer: any;
  export = mailcomposer;
}

declare module 'marked' {
  const marked: any;
  export { marked };
  export default marked;
}

declare module 'mimelib' {
  const mimelib: any;
  export = mimelib;
}

declare module 'optional-js' {
  const Optional: any;
  export = Optional;
}

declare module 'posthtml' {
  interface Result {
    html: string;
  }
  interface PostHTML {
    use(plugin: any): PostHTML;
    process(html: string, options?: any): Result & Promise<Result>;
  }
  function posthtml(): PostHTML;
  export = posthtml;
}
