// Fonts come from npm packages, so building the site never needs the network.
import '@fontsource-variable/pixelify-sans';
import '@fontsource-variable/geist-mono';
import './globals.css';

export const metadata = {
  title: 'Grablight',
  description:
    'A Chrome extension that finds the files and videos on the page you are on and downloads them in one click. A green, yellow or red light tells you if each one will work.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
