import { Wallet } from "lucide-react";
import { getDb } from "@/db/client";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { loadFinanceData } from "@/lib/data/finance-data";
import { getChurnAssumptionPct } from "@/lib/data/dashboard";
import { getProjectionSettings } from "@/lib/data/projection";
import { saveMinCashAction } from "@/lib/actions/projection";
import { getUsdHnlRate } from "@/lib/fx";
import { todayIn } from "@/lib/today";
import { formatUSD } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/crud/page-header";
import { FormDialog } from "@/components/crud/form-dialog";
import { MoneyField } from "@/components/crud/fields";
import { ProjectionView } from "@/components/projection/projection-view";

export const dynamic = "force-dynamic";

export default async function ProyeccionPage() {
  const user = await requirePage("planning");
  const canWrite = can(user.permissions, "planning", "write");
  const db = await getDb();
  const [data, fx, churn, cfg] = await Promise.all([loadFinanceData(db), getUsdHnlRate(), getChurnAssumptionPct(), getProjectionSettings()]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Proyección y escenarios"
        description="Cómo se ve tu caja las próximas 13 semanas con lo que ya sabes, y qué pasa si cambias precios, altas, churn o gastos."
      >
        {canWrite && (
          <FormDialog
            title="Caja mínima"
            description="Si la proyección baja de este monto, te avisamos en el dashboard con semanas de anticipación."
            action={saveMinCashAction}
            trigger={
              <Button variant="outline">
                <Wallet className="size-4" /> Caja mínima {cfg.minCashCents ? formatUSD(cfg.minCashCents / 100) : "sin definir"}
              </Button>
            }
          >
            <MoneyField label="Caja mínima" name="minCash" defaultCents={cfg.minCashCents || null} required hint="Ej. un mes de gastos fijos." />
          </FormDialog>
        )}
      </PageHeader>
      <ProjectionView
        data={data}
        asOf={todayIn()}
        hnlPerUsd={fx.hnlPerUsd}
        churnAssumption={churn / 100}
        minCashCents={cfg.minCashCents}
        saved={cfg.scenarios}
        canWrite={canWrite}
      />
    </div>
  );
}
