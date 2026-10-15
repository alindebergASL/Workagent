import type { ProductBody } from "@/lib/client/products";

export function ProductView({ body }: { body: ProductBody }) {
  if (body.kind === "table")
    return (
      <div
        className="product-scroll"
        tabIndex={0}
        role="region"
        aria-label="Table"
      >
        <table>
          <thead>
            <tr>
              {body.columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.rows.map((row, i) => (
              <tr key={i}>
                {body.columns.map((c) => (
                  <td key={c} data-label={c}>
                    {row[c]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  return (
    <pre className="product-code">
      {body.kind === "tool" ? body.code : body.content}
    </pre>
  );
}
