import fetch from "node-fetch";

async function run() {
  const res = await fetch("http://localhost:3000/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "https://produto.mercadolivre.com.br/MLB-4863089069" })
  });
  console.log(await res.text());
}
run();
