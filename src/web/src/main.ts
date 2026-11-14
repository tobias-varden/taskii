import { App } from './app';
import { connect } from './host';

connect()
  .then((host) => {
    const app = new App(host);
    if (import.meta.env.DEV) Object.assign(window, { taskii: app });
    return app.start();
  })
  .catch((error: unknown) => {
    console.error(error);
    const message = document.createElement('p');
    message.className = 'fatal';
    message.textContent = error instanceof Error ? error.message : String(error);
    document.body.append(message);
  });
