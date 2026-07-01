"""Flow configuration endpoints backed by flows.json."""

from fastapi import APIRouter

from orquesta_api.meta.models import FlowDefinition
from orquesta_api.services.config_files import FlowConfigStore

router = APIRouter(prefix="/flows", tags=["flows"])


@router.get("")
async def list_flows() -> list[FlowDefinition]:
    return FlowConfigStore().list()


@router.post("", status_code=201)
async def create_flow(body: FlowDefinition) -> FlowDefinition:
    return FlowConfigStore().upsert(body.id, body)


@router.put("/{flow_id}")
async def update_flow(flow_id: str, body: FlowDefinition) -> FlowDefinition:
    return FlowConfigStore().upsert(flow_id, body)


@router.delete("/{flow_id}", status_code=204)
async def delete_flow(flow_id: str) -> None:
    FlowConfigStore().delete(flow_id)
