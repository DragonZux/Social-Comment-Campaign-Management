import { Outfit } from "next/font/google";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-outfit",
});

export const metadata = {
  title: "Social Comment Campaign System",
  description: "Automate and monitor social media comment campaigns on X and Threads",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="vi"
      className="h-full antialiased"
    >
      <body className={`${outfit.className} min-h-full flex flex-col bg-white text-[#111827]`}>
        {children}
      </body>
    </html>
  );
}
