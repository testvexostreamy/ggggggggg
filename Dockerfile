FROM denoland/deno:2.9.4
WORKDIR /app
COPY deno.json ./
COPY . .
RUN deno cache main.ts
ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "deno run --allow-net --allow-env --allow-read main.ts"]
