import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "./confirm-button";
import { FormDialog } from "./form-dialog";
import type { ActionResult } from "@/lib/actions/result";

/** Botones Editar / Borrar de una fila. Se ocultan según permisos. */
export function RowActions({
  editTitle,
  editAction,
  editFields,
  deleteAction,
  deleteLabel,
  canEdit,
  canDelete,
  wide,
  extra,
}: {
  editTitle?: string;
  editAction?: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
  editFields?: React.ReactNode;
  deleteAction?: () => Promise<ActionResult>;
  deleteLabel?: string;
  canEdit: boolean;
  canDelete?: boolean;
  wide?: boolean;
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-end gap-0.5">
      {extra}
      {canEdit && editAction && editFields && (
        <FormDialog
          title={editTitle ?? "Editar"}
          action={editAction}
          wide={wide}
          trigger={
            <Button variant="ghost" size="icon" className="size-8" aria-label="Editar">
              <Pencil className="size-3.5" />
            </Button>
          }
        >
          {editFields}
        </FormDialog>
      )}
      {(canDelete ?? canEdit) && deleteAction && (
        <ConfirmButton
          title={`¿Eliminar ${deleteLabel ?? "este registro"}?`}
          description="También se revierten sus efectos en caja y aportes. No se puede deshacer."
          confirmLabel="Eliminar"
          destructive
          action={deleteAction}
          trigger={
            <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-danger" aria-label="Eliminar">
              <Trash2 className="size-3.5" />
            </Button>
          }
        />
      )}
    </div>
  );
}
