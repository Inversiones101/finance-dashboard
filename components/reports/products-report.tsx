import type { computeAffiliates, computeProductReport } from "@/lib/finance/engine";
import { Panel, Empty } from "@/components/crud/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

type Props = {
  products: ReturnType<typeof computeProductReport>;
  affiliates: ReturnType<typeof computeAffiliates>;
  money: (v: number) => string;
  period: string;
};

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

/** Rentabilidad por producto (con costos asignados) y afiliados que traen miembros. */
export function ProductsReport({ products, affiliates, money, period }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="Rentabilidad por producto"
        description={`${period}. Contribución = ingreso neto − costos asignados al producto (elige el producto al registrar un gasto). Lo no asignado va en gastos generales.`}
      >
        {products.products.length === 0 ? (
          <Empty>Sin ventas en el periodo.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">Ventas</TableHead>
                  <TableHead className="text-right">Bruto</TableHead>
                  <TableHead className="text-right">Comisiones</TableHead>
                  <TableHead className="text-right">Ingreso neto</TableHead>
                  <TableHead className="text-right">Costos asignados</TableHead>
                  <TableHead className="text-right">Contribución</TableHead>
                  <TableHead className="text-right">Margen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="tabular">
                {products.products.map((p) => (
                  <TableRow key={p.productId ?? "none"}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell className="text-right">{p.sales}</TableCell>
                    <TableCell className="text-right">{money(p.gross)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{money(-(p.fees + p.affiliate))}</TableCell>
                    <TableCell className="text-right">{money(p.net)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{p.costs ? money(-p.costs) : "—"}</TableCell>
                    <TableCell className={cn("text-right font-semibold", p.contribution < 0 && "text-money-out-text")}>{money(p.contribution)}</TableCell>
                    <TableCell className="text-right">{pct(p.margin)}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    Gastos generales (sin producto)
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">{money(-products.generalCosts)}</TableCell>
                  <TableCell />
                </TableRow>
                <TableRow className="font-semibold">
                  <TableCell colSpan={6}>Resultado operativo del periodo</TableCell>
                  <TableCell className={cn("text-right", products.result < 0 && "text-money-out-text")}>{money(products.result)}</TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>

      <Panel
        title="Afiliados"
        description="Quién trae miembros (columna “Invited By” del CSV de Skool). Skool les paga la comisión directamente: aquí ves cuánto te cuesta cada uno y cuánto trae."
      >
        {affiliates.length === 0 ? (
          <Empty>Aún no hay miembros referidos. Se llenan al importar el CSV de Skool.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Afiliado</TableHead>
                  <TableHead className="text-right">Referidos</TableHead>
                  <TableHead className="text-right">Activos</TableHead>
                  <TableHead className="text-right">MRR que aportan</TableHead>
                  <TableHead className="text-right">Cobros del periodo</TableHead>
                  <TableHead className="text-right">Comisiones</TableHead>
                  <TableHead className="text-right">Costo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="tabular">
                {affiliates.map((a) => (
                  <TableRow key={a.name}>
                    <TableCell className="font-medium">{a.name}</TableCell>
                    <TableCell className="text-right">{a.referred}</TableCell>
                    <TableCell className="text-right">{a.active}</TableCell>
                    <TableCell className="text-right">{money(a.mrr)}</TableCell>
                    <TableCell className="text-right">{money(a.gross)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{a.commissions ? money(-a.commissions) : "—"}</TableCell>
                    <TableCell className="text-right">{pct(a.costPct)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>
    </div>
  );
}
