import {V2beta1Pipeline, V2beta1PipelineVersion} from "../../apisv2beta1/pipeline";
import {V2beta1Run} from "../../apisv2beta1/run";
import {Action, katibCSS} from "./common";
import Input from "../../atoms/Input";
import MenuItem from "@material-ui/core/MenuItem";
import React, {useEffect, useState} from "react";
import {useQuery} from "react-query";
import {filterRunArtifactsByType, getRunArtifact, MlmdPackage} from "../../pages/CompareV2";
import {
    getArtifactName,
    getArtifactsFromContext, getArtifactTypes,
    getEventsByExecutions, getExecutionDisplayName,
    getExecutionsFromContext,
    getKfpV2RunContext
} from "../../mlmd/MlmdUtils";
import {ArtifactType, Value} from "../../third_party/mlmd";
import {MetricsType, RunArtifact} from "../../lib/v2/CompareUtils";
import * as jspb from "google-protobuf";
import Banner from "../Banner";
import {commonCss} from "../../Css";
import Separator from "../../atoms/Separator";
import {Button} from "@material-ui/core";
import AddIcon from "@material-ui/icons/Add";
import Grid from "@material-ui/core/Grid";
import DeleteIcon from "@material-ui/icons/Delete";
import Dialog from "@material-ui/core/Dialog";
import DialogTitle from "@material-ui/core/DialogTitle";
import DialogContent from "@material-ui/core/DialogContent";
import DialogActions from "@material-ui/core/DialogActions";

interface MetricInfo {
    id: string;
    display_name: string;
    parent: string
}

type ObjectiveType = 'maximize' | 'minimize'

interface ObjectiveConfig {
    type: ObjectiveType;
    metric: MetricInfo
    goal: number | undefined
}

interface ObjectivesProps {
    pipeline: V2beta1Pipeline;
    pipelineVersion: V2beta1PipelineVersion;
    lastRun: V2beta1Run | undefined;
    mainObjective?: ObjectiveConfig;
    additionalObjectives: ObjectiveConfig[];

    handleObjectiveChange: (objective: ObjectiveConfig, action: Action) => void;
}

interface ObjectiveFormProps {
    objective: ObjectiveConfig;
    handleObjectiveChange: (objective: ObjectiveConfig, action: Action) => void;
}

function ObjectiveForm(props: ObjectiveFormProps) {
    return (
        <div>
            <Input
                label='Parameter name'
                style={{width: '100%'}}
                select={true}
                onChange={(e) => props.handleObjectiveChange({
                    ...props.objective,
                    type: e.target.value as ObjectiveType,
                }, Action.UPDATE)}
                value={props.objective.type}
                variant='outlined'
            >
                <MenuItem value={'maximize'}>
                    Maximize
                </MenuItem>
                <MenuItem value={'minimize'}>
                    Minimize
                </MenuItem>
            </Input>
            {
                (props.objective.goal !== undefined) && (
                    <Input
                        style={{width: '100%'}}
                        label='Goal'
                        onChange={(e) => props.handleObjectiveChange({
                            ...props.objective,
                            goal: Number(e.target.value)
                        }, Action.UPDATE)}
                        value={props.objective.goal}
                        variant='outlined'
                    />
                )
            }

        </div>
    )
}

function Objectives(props: ObjectivesProps) {

    /* Dialog related */
    const [additionalMetricDialogOpen, setAdditionalMetricDialogOpen] = useState<boolean>(false);
    const [metricSelectedDialog, setMetricSelectedDialog] = useState<string | undefined>(undefined);

    const [metricsInfo, setMetricsInfo] = useState<MetricInfo[]>([]);
    const [error, setError] = useState<string | undefined>(undefined);

    const mainMetricId = props.mainObjective?.metric?.id;

    // Extract runIds
    const runId: string | undefined = props.lastRun?.run_id;

    // Retrieves MLMD state (executions and linked artifacts) from the MLMD store.
    const {
        data: mlmdPackage,
        isLoading: isLoadingMlmdPackages,
        isError: isErrorMlmdPackage,
        error: errorMlmdPackage,
    } = useQuery<MlmdPackage, Error>(
        ['run_artifacts', { runId }],
        async () => {
            if (runId === undefined)
                throw Error('The runId is undefined. Cannot fetch V2RunContext')

            const context = await getKfpV2RunContext(runId);
            console.log('context', context);
            const executions = await getExecutionsFromContext(context);
            console.log('executions', executions);
            const artifacts = await getArtifactsFromContext(context);
            console.log('artifacts', artifacts);
            const events = await getEventsByExecutions(executions);
            console.log('events', events);
            return {
                executions,
                artifacts,
                events,
            } as MlmdPackage;
        },
        {
            staleTime: Infinity,
        },
    );

    const {
        data: artifactTypes,
        isLoading: isLoadingArtifactTypes,
        isError: isErrorArtifactTypes,
        error: errorArtifactTypes,
    } = useQuery<ArtifactType[], Error>(['artifact_types', {}], () => getArtifactTypes(), {
        staleTime: Infinity,
    });

    useEffect(() => {
        if(props.lastRun === undefined || mlmdPackage === undefined || artifactTypes === undefined)
            return;

        // TODO: create a function called "getRunCustomProperties()" to simplify fetching those infos
        const runArtifact: RunArtifact = getRunArtifact(props.lastRun, mlmdPackage);
        const scalarMetricsArtifactData = filterRunArtifactsByType(
            [runArtifact],
            artifactTypes,
            MetricsType.SCALAR_METRICS,
        );

        let metricsInfo: MetricInfo[] = [];

        if (scalarMetricsArtifactData.runArtifacts.length === 0) {
            setError('Cannot found scalar metrics run artifacts in last experiment run.');
            return;
        }

        for (const runArtifact of scalarMetricsArtifactData.runArtifacts) {
            for (const executionArtifact of runArtifact.executionArtifacts) {
                const executionText: string = getExecutionDisplayName(executionArtifact.execution) || '-';
                for (const linkedArtifact of executionArtifact.linkedArtifacts) {
                    const linkedArtifactText: string = getArtifactName(linkedArtifact) || '-';
                    const metricLabel = `${executionText} > ${linkedArtifactText}`;

                    const customProperties: jspb.Map<string, Value> = linkedArtifact.artifact.getCustomPropertiesMap();
                    for (const entry of customProperties.getEntryList()) {
                        const scalarMetricName: string = entry[0];
                        if (scalarMetricName === 'display_name') {
                            continue;
                        }
                        metricsInfo.push({
                            parent: metricLabel,
                            display_name: scalarMetricName,
                            id: `${executionText}:${linkedArtifactText}:${scalarMetricName}`
                        });
                    }
                }
            }
        }

        setMetricsInfo(metricsInfo);
    }, [props.lastRun, mlmdPackage, artifactTypes]);

    useEffect(() => {
        if (isErrorMlmdPackage) {
            setError(errorMlmdPackage?.message || 'Something went wrong while fetching MlmdPackages');
            return;
        }

        if (isErrorArtifactTypes) {
            setError(errorArtifactTypes?.message || 'Something went wrong while fetching artifacts types.');
            return;
        }

        setError(undefined);
    }, [isErrorArtifactTypes, errorMlmdPackage, isErrorMlmdPackage, errorArtifactTypes]);

    const handleChangeObjective = (metric_id: string, isMain: boolean = false) => {
        const metricInfo = metricsInfo.find((metric) => metric.id === metric_id);
        if (metricInfo === undefined)
            throw Error('handleChangeObjective received unknown metric_id.');

        console.log('old mainObjective', props.mainObjective);
        if (props.mainObjective && isMain)
            props.handleObjectiveChange(props.mainObjective, Action.DELETE);

        props.handleObjectiveChange({
            metric: metricInfo,
            type: 'maximize',
            goal: isMain?0.99:undefined
        }, Action.ADD);
    }

    if (isLoadingArtifactTypes || isLoadingMlmdPackages)
        return (
            <Banner message={'Artifacts are loading.'} mode={'info'}/>
        )

    if (error)
        return <Banner message={error} mode={'error'}/>

    return (
        <div>
            <div className={commonCss.header}>Katib Experiment objective(s)</div>
            <div>
                <div>Main objective</div>
                <Input
                    style={{width: '100%'}}
                    label='Parameter name'
                    select={true}
                    onChange={(e) => handleChangeObjective(e.target.value, true)}
                    value={mainMetricId ?? 'None'}
                    variant='outlined'
                >
                    {metricsInfo.map((metric, i) => (
                        <MenuItem key={i} value={metric.id}>
                            {metric.parent}: <strong>{metric.display_name}</strong>
                        </MenuItem>
                    ))}
                </Input>
                {
                    props.mainObjective && (
                        <ObjectiveForm
                            objective={props.mainObjective}
                            handleObjectiveChange={props.handleObjectiveChange}
                        />
                    )
                }
                <Separator/>
                <div>Additional metrics</div>
                <Button
                    onClick={() => setAdditionalMetricDialogOpen(true)}
                    color={'primary'}
                    disabled={(metricsInfo.length < props.additionalObjectives.length + 2)}
                >
                    <AddIcon/>
                    Add Additional Metric
                </Button>
                {
                    props.additionalObjectives
                        .sort((a, b) => (a.metric.id.localeCompare(b.metric.id)))
                        .map((additionalObjective, i) => {
                            return (
                                <Grid style={{display: 'flex', alignItems: 'center'}} key={i} container spacing={8}>
                                    <Grid item xs={7}>
                                        <Input
                                            label='Additional Objective'
                                            onChange={(e) => handleChangeObjective(e.target.value, true)}
                                            value={`${additionalObjective.metric.parent}: ${additionalObjective.metric.display_name}`}
                                            disabled={true}
                                            variant='outlined'
                                        />
                                    </Grid>
                                    <Grid item xs={4}>
                                        <ObjectiveForm
                                            objective={additionalObjective}
                                            handleObjectiveChange={props.handleObjectiveChange}
                                        />
                                    </Grid>
                                    <Grid item xs={1}>
                                        <Button onClick={() => {
                                            props.handleObjectiveChange(additionalObjective, Action.DELETE)
                                        }}>
                                            <DeleteIcon/>
                                        </Button>
                                    </Grid>
                                </Grid>
                            )
                        })
                }
                <Dialog
                    open={additionalMetricDialogOpen}
                    classes={{ paper: katibCSS.selectorDialog }}
                    onClose={() => {
                        setAdditionalMetricDialogOpen(false)
                    }}
                    PaperProps={{ id: 'experimentSelectorDialog' }}
                >
                    <DialogTitle>Choose an additional metric</DialogTitle>
                    <DialogContent>
                        <div>Configure the new parameter that will be added to the list.</div>
                        <Input
                            label='Parameter name'
                            select={true}
                            onChange={(e) => setMetricSelectedDialog(e.target.value)}
                            value={metricSelectedDialog ?? 'None'}
                            variant='outlined'
                        >
                            {metricsInfo.filter((metric) => {
                                return metric.id !== mainMetricId && props
                                    .additionalObjectives.find((_obj) => _obj.metric.id === metric.id) === undefined;
                            }).map((metric, i) => (
                                <MenuItem key={i} value={metric.id}>
                                    {metric.parent}: <strong>{metric.display_name}</strong>
                                </MenuItem>
                            ))}
                        </Input>

                    </DialogContent>
                    <DialogActions>
                        <Button
                            id='paramDialogCancelBtn'
                            onClick={() => setAdditionalMetricDialogOpen(false)}
                            color='secondary'
                        >
                            Cancel
                        </Button>
                        <Button
                            id='paramDialogValidateBtn'
                            disabled={metricSelectedDialog === undefined}
                            onClick={() => {
                                const metric = metricsInfo.find((metric) =>
                                    metric.id === metricSelectedDialog
                                );
                                if (metric === undefined)
                                    throw Error('Cannot find metric.');
                                props.handleObjectiveChange({
                                    metric:metric,
                                    type: 'maximize',
                                    goal: undefined
                                }, Action.ADD);
                                setMetricSelectedDialog(undefined);
                                setAdditionalMetricDialogOpen(false);
                            }}
                            color='primary'
                        >
                            Validate
                        </Button>
                    </DialogActions>
                </Dialog>
            </div>
        </div>
    )
}

export { Objectives };
export type { ObjectiveConfig };
