// Test-only probe. The visual MCP tools do not evaluate this in user pages.
export function identity() {
  const canvas = document.createElement('canvas');
  canvas.width = 160; canvas.height = 40;
  const context = canvas.getContext('2d');
  context.fillStyle = '#314159';
  context.fillRect(0, 0, 160, 40);
  context.fillStyle = '#fff';
  context.fillText('Local browser identity', 4, 24);
  const webdriver = Object.getOwnPropertyDescriptor(Navigator.prototype, 'webdriver');
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    userAgentData: navigator.userAgentData?.toJSON(),
    languages: [...navigator.languages],
    webdriver: navigator.webdriver,
    webdriverOwn: Object.hasOwn(navigator, 'webdriver'),
    webdriverDescriptor: webdriver ? {configurable: webdriver.configurable, enumerable: webdriver.enumerable, getter: String(webdriver.get)} : null,
    hardwareConcurrency: navigator.hardwareConcurrency,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    offset: new Date().getTimezoneOffset(),
    screen: {width: screen.width, height: screen.height, depth: screen.colorDepth},
    nativeFunctions: [Function.prototype.toString, Object.getOwnPropertyNames, Reflect.ownKeys, HTMLCanvasElement.prototype.toDataURL].map(fn => String(fn)),
    canvas: canvas.toDataURL(),
    syntheticEventTrusted: new Event('probe').isTrusted
  };
}
