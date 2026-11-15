# Master Video Editor

A modern web application built with React, Vite, and Tailwind CSS.

## 🚀 Deployment to Vercel

This repository is pre-configured for seamless deployment to [Vercel](https://vercel.com).

### Option 1: Deploy via Vercel Dashboard (Recommended)

1. Push your code to your GitHub repository:
   ```bash
   git add .
   git commit -m "Configure project for GitHub and Vercel"
   git push origin main
   ```
2. Go to the [Vercel Dashboard](https://vercel.com/new).
3. Click **"Import Project"** and select your GitHub repository (`ys-sites/video`).
4. Vercel automatically detects the **Vite** preset (`Build Command: vite build`, `Output Directory: dist`).
5. (Optional) Add any environment variables required by your application (e.g., `GEMINI_API_KEY`) under **Environment Variables**.
6. Click **Deploy**.

Every future push to `main` will automatically trigger a new production deployment, and pull requests will get preview environments.

### Option 2: Deploy via Vercel CLI

```bash
# Install Vercel CLI globally
npm install -g vercel

# Deploy preview
vercel

# Deploy to production
vercel --prod
```

## 🛠️ Local Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build locally
npm run preview
```
