import {PageProps} from "./Page";
import React, {useEffect, useState} from "react";
import {NamespaceContext} from "../lib/KubeflowClient";
import {classes, stylesheet} from "typestyle";
import {commonCss, padding} from "../Css";
import {QUERY_PARAMS} from "../components/Router";
import {
    ExperimentSelector,
    getLatestVersion,
    PipelineSelector,
    PipelineVersionSelector,
    SpecParameters
} from "./NewRunV2";
import {URLParser} from "../lib/URLParser";
import {V2beta1Pipeline, V2beta1PipelineVersion} from "../apisv2beta1/pipeline";
import {V2beta1Experiment} from "../apisv2beta1/experiment";
import {Stepper, Step, StepLabel, Button} from '@material-ui/core';
import SettingsIcon from "@material-ui/icons/Settings";
import FunctionsIcon from '@material-ui/icons/Functions';
import TextFields from '@material-ui/icons/TextFields';
import Search from '@material-ui/icons/Search';
import {StepIconProps} from "@material-ui/core/StepIcon/StepIcon";
import {blue} from "@material-ui/core/colors";
import * as JsYaml from "js-yaml";
import Card from '@material-ui/core/Card';
import CardContent from '@material-ui/core/CardContent';
import {convertYamlToV2PipelineSpec, isTemplateV2} from "../lib/v2/WorkflowUtils";
import Banner from "../components/Banner";
import Dialog from "@material-ui/core/Dialog";
import DialogContent from "@material-ui/core/DialogContent";
import DialogActions from "@material-ui/core/DialogActions";
import DialogTitle from "@material-ui/core/DialogTitle";
import AddIcon from '@material-ui/icons/Add';
import EditIcon from '@material-ui/icons/Edit';
import LockIcon from '@material-ui/icons/Lock';
import DeleteIcon from '@material-ui/icons/Delete';

import Grid from '@material-ui/core/Grid';
import TableBody from '@material-ui/core/TableBody';
import TableCell from '@material-ui/core/TableCell';
import TableHead from '@material-ui/core/TableHead';
import TableRow from '@material-ui/core/TableRow';
import Input from "../atoms/Input";
import MenuItem from "@material-ui/core/MenuItem";
import {ParameterType_ParameterTypeEnum} from "../generated/pipeline_spec/pipeline_spec";
import {protoMap} from "../components/NewRunParametersV2";
import {Apis, RunSortKeys} from "../lib/Apis";
import {V2beta1Filter, V2beta1PredicateOperation} from "../apisv2beta1/filter";
import {V2beta1Run} from "../apisv2beta1/run";
import {logger} from "../lib/Utils";
import {useQuery} from "react-query";
import {
    getArtifactName,
    getArtifactsFromContext, getArtifactTypes,
    getEventsByExecutions, getExecutionDisplayName,
    getExecutionsFromContext,
    getKfpV2RunContext
} from "../mlmd/MlmdUtils";
import {filterRunArtifactsByType, getRunArtifact, MlmdPackage} from "./CompareV2";
import {MetricsType, RunArtifact} from "../lib/v2/CompareUtils";
import {ArtifactType, Value} from "../third_party/mlmd";
import * as jspb from "google-protobuf";
import Separator from "../atoms/Separator";

const steps = [
    { label: 'Experiment Details'},
    { label: 'Parameters'},
    { label: 'Objectives'},
    { label: 'Advanced'}
];


const css = stylesheet({
    selectorDialog: {
        // If screen is small, use calc(100% - 120px). If screen is big, use 1200px.
        width: 600,
    },
    lockedDomain: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
    }
});

function Advanced() {
    return (
        <></>
    )
}

interface RangeConfig {
    min: number;
    max: number;
    step: number;
}

type ObjectiveType = 'maximize' | 'minimize'

interface ObjectiveConfig {
    type: ObjectiveType;
    metric: MetricInfo
    goal: number | undefined
}

interface MetricInfo {
    id: string;
    display_name: string;
    parent: string
}

enum Action {
    ADD = "add",
    DELETE = "delete",
    UPDATE = "update",
    REQUEST_UPDATE = "request-update",
    CANCEL_UPDATE = "cancel-update",
}

interface ListConfig {
    list: string[];
}

type FeasibleSpace = RangeConfig | ListConfig | string;

type ParameterType = 'double' | 'int' | 'categorical' | 'discrete';

interface ParameterConfig {
    key: string;
    parameterType: ParameterType;
    feasibleSpace: FeasibleSpace
}

interface StepParametersConfigSpecificProps {
    specParameters: SpecParameters
    parametersConfigs: ParameterConfig[];
    handleParameterChange: (paramConfig: ParameterConfig, action: Action) => void;
    editingParamConfig: ParameterConfig | undefined;
}
type StepParametersConfigProps = PageProps & StepParametersConfigSpecificProps;

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
                    classes={{ paper: css.selectorDialog }}
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


interface ParametersTableProps {
    parameterConfigs: ParameterConfig[];
    handleParameterChange: (paramConfig: ParameterConfig, action: Action) => void;
}

function ParametersTable(props: ParametersTableProps) {
    const renderDomain = (parameterConfig: ParameterConfig) => {
        if (typeof parameterConfig.feasibleSpace === "string") {
            return (
                <div className={css.lockedDomain}>
                    <LockIcon style={{width: '12px'}}/>
                    <div>{parameterConfig.feasibleSpace}</div>
                </div>
            )
        }

        if ('list' in parameterConfig.feasibleSpace) {
            return parameterConfig.feasibleSpace.list.join(', ');
        } else {
            const { min, max, step } = parameterConfig.feasibleSpace;
            return `${min} ≤ ${parameterConfig.key} ≤ ${max}, +${step}`;
        }
    };

    return (
        <table style={{width: '100%'}}>
            <TableHead>
                <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell>Domain</TableCell>
                    <TableCell>Action</TableCell>
                </TableRow>
            </TableHead>
            <TableBody>
                {props.parameterConfigs.map((config) => (
                    <TableRow key={config.key}>
                        <TableCell>{config.key}</TableCell>
                        <TableCell>{config.parameterType}</TableCell>
                        <TableCell>{renderDomain(config)}</TableCell>
                        <TableCell>
                            <Button onClick={() => props.handleParameterChange(config, Action.REQUEST_UPDATE)}>
                                <EditIcon/>
                            </Button>
                            <Button
                                onClick={() => props.handleParameterChange(config, Action.DELETE)}>
                                <DeleteIcon/>
                            </Button>
                        </TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </table>
    );
}

function ParametersConfig(props: StepParametersConfigProps) {

    const paramKeys: string[] = Object.keys(props.specParameters);
    const beautifiedTypes: { [key: string]: string } = paramKeys.reduce((dict, item) => {
        dict[item] = protoMap.get(ParameterType_ParameterTypeEnum[props.specParameters[item].parameterType]);
        return dict;
    }, {});

    // dialog related
    const [paramSelectorOpen, setParamSelectorOpen] = useState(false);
    const [key, setKey] = useState<string | undefined>(props.editingParamConfig?.key);
    const [parameterType, setParameterType] = useState<string | undefined>(props.editingParamConfig?.parameterType);
    const [feasibleSpace, setFeasibleSpace] = useState<FeasibleSpace | undefined>(props.editingParamConfig?.feasibleSpace);
    const [dialogFormValid, setDialogFormValid] = useState<boolean>(false);
    const [dialogFormError, setDialogFormError] = useState<string | undefined>(undefined);

    useEffect(() => {
        if(props.editingParamConfig) {
            console.log(props.editingParamConfig);
            setKey(props.editingParamConfig.key);
            setParameterType(props.editingParamConfig.parameterType);
            setFeasibleSpace(props.editingParamConfig.feasibleSpace);
            setParamSelectorOpen(true);
        }
    }, [props.editingParamConfig]);

    useEffect(() => {
        if(!paramSelectorOpen && props.editingParamConfig) {
            props.handleParameterChange(props.editingParamConfig, Action.CANCEL_UPDATE);
        }
    }, [paramSelectorOpen, props]);

    useEffect(() => {
        if(props.editingParamConfig)
            return;

        switch (parameterType) {
            case 'Discrete':
            case 'Categorical':
                setFeasibleSpace({list: []});
                break;
            case 'Integer':
            case 'Double':
                setFeasibleSpace({min: 0, max: 10, step: 1});
                break;
            case 'Constant':
                setFeasibleSpace('');
                break;
        }
    },
        [parameterType, props.editingParamConfig]);

    const handleKeyChange = (value: string) => {
        if (paramKeys.indexOf(value) === -1)
            throw Error('handleKeyChange received value ' + value);
        setKey(value);
        setParameterType(undefined);
        setFeasibleSpace(undefined);
    }

    // if dialogFormValid is true we reset the dialog form error
    useEffect(() => {
        if(dialogFormValid)
            setDialogFormError(undefined);
    }, [dialogFormValid]);

    useEffect(() => {
        if (feasibleSpace === undefined) {
            setDialogFormValid(false);
            return;
        }

        // We only empty value therefore no need to check for anything
        if (typeof feasibleSpace === 'string') {
            setDialogFormValid(true);
            return;
        }

        if ('list' in feasibleSpace) {
            const uniqueSet = new Set(feasibleSpace.list);
            if (uniqueSet.size !== feasibleSpace.list.length) {
                setDialogFormValid(false);
                setDialogFormError('You cannot have duplicates in your parameter list value.');
            } else {
                setDialogFormValid(true);
            }
            return;
        }

        if ('min' in feasibleSpace) {
            if (feasibleSpace.min >= feasibleSpace.max) {
                setDialogFormValid(false);
                setDialogFormError('The minimum value cannot be greater or equal to the maximum.');
            } else {
                setDialogFormValid(true);
            }
            return;
        }

    }, [feasibleSpace]);

    const _getParameterTypeInput = () => {
        if(!key)
            return <></>

        let options: string[];
        switch (beautifiedTypes[key]) {
            case 'double':
                options = ['Double', 'Discrete', 'Categorical', 'Constant'];
                break;
            case 'integer':
                options = ['Integer', 'Discrete', 'Categorical', 'Constant'];
                break;
            case 'string':
                options = ['Discrete', 'Categorical', 'Constant']
                break;
            case 'list': // TODO: study that
            case 'dict': // TODO: study that
            case 'boolean': // TODO: study that
            default:
                return <Banner message={'The type ' + key + ' is not compatible'} mode='error' isLeftAlign={true} />
        }
        return (
            <>
                <div>The parameter type tells katib what to vary in the experiment.</div>
                <Input
                    label='Parameter Type'
                    select={true}
                    onChange={(e) => setParameterType(e.target.value)}
                    value={parameterType ?? 'None'}
                    variant='outlined'
                >
                    {options.map((option, i) => (
                        <MenuItem key={i} value={option}>
                            {option}
                        </MenuItem>
                    ))}
                </Input>
            </>
        )
    }

    const _getFeasibleSpaceForm = () => {
        if (!parameterType)
            return <></>;

        switch (parameterType) {
            case 'Discrete':
            case 'Categorical':
                if (feasibleSpace === undefined || typeof feasibleSpace === 'string' || ('min' in feasibleSpace)) {
                    return <></>;
                }

                return (
                    <>
                        <Button
                            onClick={() => setFeasibleSpace((prevState) => {
                                return {list: [...(prevState as ListConfig).list, '']}
                            })}
                            color={'primary'}
                        >
                            <AddIcon/>
                            Add value
                        </Button>
                        {
                            feasibleSpace.list.map((value, index) => {
                                return (
                                    <Input
                                        key={index}
                                        label='Value'
                                        required={true}
                                        type='text'
                                        onChange={(e) => {
                                            e.persist()
                                            setFeasibleSpace((prevState) => {
                                                const newList = (prevState as ListConfig).list;
                                                // weird case when unfocusing and typing at the same time
                                                if (e.target !== null) {
                                                    newList[index] = e.target.value;
                                                }
                                                return {list: newList};
                                            })}
                                        }
                                        value={value}
                                        variant='outlined'
                                    />
                                )
                            })
                        }
                    </>
                )
            case 'Integer':
            case 'Double':
                if (feasibleSpace === undefined || typeof feasibleSpace === 'string' || !('min' in feasibleSpace)) {
                    return <></>;
                }

                return (
                    <>
                        <Grid container spacing={8}>
                            <Grid item xs={4}>
                                <Input
                                    label='Minimum'
                                    required={true}
                                    type='number'
                                    onChange={(e) => {
                                        e.persist()
                                        setFeasibleSpace((prevState) => {
                                            // TODO: make a function to extract that.
                                            let parsed: number
                                            if(parameterType === 'Integer') {
                                                parsed = parseInt(e.target.value)
                                            } else {
                                                parsed = Number(e.target.value);
                                            }
                                            return {...prevState as RangeConfig, min: isNaN(parsed)?0:parsed}
                                        })}
                                    }
                                    value={feasibleSpace.min}
                                    variant='outlined'
                                />
                            </Grid>
                            <Grid item xs={4}>
                                <Input
                                    label='Maximum'
                                    required={true}
                                    type='number'
                                    onChange={(e) => {
                                        e.persist()
                                        setFeasibleSpace((prevState) => {
                                            const parsed = Number(e.target.value);
                                            return {...prevState as RangeConfig, max: isNaN(parsed)?0:parsed}
                                        })
                                    }}
                                    value={feasibleSpace.max}
                                    variant='outlined'
                                />
                            </Grid>
                            <Grid item xs={4}>
                                <Input
                                    label='Step'
                                    required={true}
                                    type='number'
                                    onChange={(e) => {
                                        e.persist()
                                        setFeasibleSpace((prevState) => {
                                            const parsed = Number(e.target.value);
                                            return {...prevState as RangeConfig, step: isNaN(parsed)?0:parsed}
                                        })
                                    }}
                                    value={feasibleSpace.step}
                                    variant='outlined'
                                />
                            </Grid>
                        </Grid>
                    </>
                )
            case 'Constant':
                if (typeof feasibleSpace !== "string")
                    return <></>
                return (
                    <>
                        <div>The value defined here will set the variable as constant in the experiment.</div>
                        <Input
                            label='Constant value'
                            required={true}
                            type='text'
                            onChange={(e) => {
                                setFeasibleSpace(e.target.value)
                            }}
                            value={feasibleSpace}
                            variant='outlined'
                        />
                    </>
                )
            default:
                throw Error('The parameterType ' + parameterType + ' is not recognized.');
        }
    }

    return (
        <div>
            <div className={commonCss.header}>Pipeline parameters config</div>

            { (paramKeys.length > 0)?(
                <Button
                    onClick={() => {
                        setKey(undefined);
                        setParameterType(undefined);
                        setFeasibleSpace(undefined);
                        setParamSelectorOpen(true);
                    }}
                    color={'primary'}
                >
                    <AddIcon/>
                    Add Parameter
                </Button>
            ):<div>Your pipeline does not have any run parameters.</div> }

            <ParametersTable
                handleParameterChange={props.handleParameterChange}
                parameterConfigs={props.parametersConfigs}
            />

            <Dialog
                open={paramSelectorOpen}
                classes={{ paper: css.selectorDialog }}
                onClose={() => {
                    setParamSelectorOpen(false)
                }}
                PaperProps={{ id: 'experimentSelectorDialog' }}
            >
                <DialogTitle>{props.editingParamConfig?'Update Parameter':'Add new parameter'}</DialogTitle>
                <DialogContent>
                    {
                        dialogFormError && (
                            <Banner message={dialogFormError} mode='error' isLeftAlign={true} />
                        )
                    }
                    <div>Configure the new parameter that will be added to the list.</div>
                    <Input
                        label='Parameter name'
                        select={true}
                        onChange={(e) => handleKeyChange(e.target.value)}
                        value={key ?? 'None'}
                        variant='outlined'
                        disabled={props.editingParamConfig !== undefined}
                    >
                        {paramKeys.map((paramKey, i) => (
                            <MenuItem key={i} value={paramKey}>
                                {paramKey} - ({beautifiedTypes[paramKey]})
                            </MenuItem>
                        ))}
                    </Input>

                    {
                        _getParameterTypeInput()
                    }
                    {
                        _getFeasibleSpaceForm()
                    }

                </DialogContent>
                <DialogActions>
                    <Button
                        id='paramDialogCancelBtn'
                        onClick={() => setParamSelectorOpen(false)}
                        color='secondary'
                    >
                        Cancel
                    </Button>
                    <Button
                        id='paramDialogValidateBtn'
                        disabled={!dialogFormValid}
                        onClick={() => {
                            props.handleParameterChange(
                                {
                                    key: key!!,
                                    parameterType: parameterType as ParameterType,
                                    feasibleSpace: feasibleSpace as FeasibleSpace
                                },
                                (props.editingParamConfig!== undefined)?Action.UPDATE:Action.ADD
                            )
                            //TODO: do stuff
                            setParamSelectorOpen(false);
                        }}
                        color='primary'
                    >
                        Validate
                    </Button>
                </DialogActions>
            </Dialog>
        </div>


    )
}

interface StepExperimentDetailsSpecificProps {
    pipeline: V2beta1Pipeline | undefined;
    pipelineVersion: V2beta1PipelineVersion | undefined;
    experiment: V2beta1Experiment | undefined;
    handlePipelineChange: (pipeline: V2beta1Pipeline) => void;
    handlePipelineVersionChange: (pipeline: V2beta1PipelineVersion) => void;
    handleExperimentChange: (experiment: V2beta1Experiment) => void;
}
type StepExperimentDetailsProps = PageProps & StepExperimentDetailsSpecificProps;

function ExperimentDetails(props: StepExperimentDetailsProps) {
    const [pipelineDisplayName, setPipelineDisplayName] = useState<string>('');
    const [pipelineVersionDisplayName, setPipelineVersionDisplayName] = useState<string>('');
    const [experimentDisplayName, setExperimentDisplayName] = useState<string>('');

    useEffect(() => {
        setPipelineDisplayName(props.pipeline?.display_name || '');
        setPipelineVersionDisplayName(props.pipelineVersion?.display_name || '');
        setExperimentDisplayName(props.experiment?.display_name || '');
    }, [props.pipeline, props.pipelineVersion, props.experiment])
    return (
        <div>
            <div className={commonCss.header}>Katib Experiment details</div>
            {/* Pipeline selection */}
            <div>You need to select a kubeflow pipeline that will be associate with the katib experiment</div>
            <PipelineSelector
                {...props}
                maxWidth={'100%'}
                pipelineName={pipelineDisplayName}
                handlePipelineChange={props.handlePipelineChange}
            />

            {/* Pipeline version selection */}
            <PipelineVersionSelector
                {...props}
                maxWidth={'100%'}
                pipeline={props.pipeline}
                pipelineVersionName={pipelineVersionDisplayName}
                handlePipelineVersionChange={props.handlePipelineVersionChange}
            />

            {/* Experiment selection */}
            <div>This katib experiment will be associated with the following experiment</div>
            <ExperimentSelector
                {...props}
                maxWidth={'100%'}
                experimentName={experimentDisplayName}
                handleExperimentChange={props.handleExperimentChange}
            />
        </div>
    )
}

function ColorlibStepIcon(props: StepIconProps) {
    const icons = {
        1: <TextFields />,
        2: <FunctionsIcon />,
        3: <Search />,
        4: <SettingsIcon />
    };

    return (
        <div style={props.active?{color: blue[600]}:{}}>
            {icons[String(props.icon)]}
        </div>
    );
}

function NewKatibExperiment(props: PageProps) {
    const namespace = React.useContext(NamespaceContext);
    const [error, setError] = useState<string | undefined>(undefined);

    const [activeStep, setActiveStep] = useState(0);

    const urlParser = new URLParser(props);

    /* Required for experiment details step*/
    const [pipeline, setPipeline] = useState<V2beta1Pipeline | undefined>(undefined)
    const [pipelineVersion, setPipelineVersion] = useState<V2beta1PipelineVersion | undefined>(undefined);
    const [experiment, setExperiment] = useState<V2beta1Experiment | undefined>(undefined);

    /* Required for parameters step */
    const [specParameters, setSpecParameters] = useState<SpecParameters>({});
    const [editingParamConfig, setEditingParamConfig] = useState<ParameterConfig | undefined>(undefined);
    const [parametersConfigs, setParametersConfigs] = useState<ParameterConfig[]>([]);

    const pipelineSpecInVersion = pipelineVersion?.pipeline_spec;
    const templateString = pipelineSpecInVersion ? JsYaml.safeDump(pipelineSpecInVersion) : '';

    /* Required for objectives step */
    const [fetchingLastRuns, setFetchingLastRuns] = useState<boolean>(false);
    const [lastRun, setLastRun] = useState<V2beta1Run | undefined>(undefined);
    const [objectives, setObjectives] = useState<ObjectiveConfig[]>([]);

    /* When the experiment change we fetch the last 5 runs in it */
    useEffect(() => {
        if(experiment === undefined || fetchingLastRuns)
            return;

        if (lastRun !== undefined && lastRun.experiment_id === experiment.experiment_id)
            return;

        setFetchingLastRuns(true);
        Apis.runServiceApiV2.listRuns(
            namespace,
            experiment.experiment_id,
            undefined /* pageToken */,
            1 /* pageSize */,
            RunSortKeys.CREATED_AT + ' desc',
            encodeURIComponent(
                JSON.stringify({
                    predicates: [
                        {
                            key: 'state',
                            operation: V2beta1PredicateOperation.EQUALS,
                            string_value: 'SUCCEEDED',
                        },
                    ],
                } as V2beta1Filter),
            ),
        ).then((response) => {
            if (response.total_size === undefined || response.total_size === 0 || response.runs === undefined) {
                setError('The experiment provided does not have any runs in it. You need at least one run of the successful pipeline specified in it.');
                setExperiment(undefined);
                return;
            }

            const run = response.runs[0];
            const version_reference = run.pipeline_version_reference;
            if (version_reference === undefined) {
                setError(`The latest run found in ${experiment.display_name} does not have version reference.`);
                setExperiment(undefined);
                return;
            }

            if (version_reference.pipeline_id !== pipeline!!.pipeline_id) {
                setError(`The last run in ${experiment.display_name} does not correspond to the pipeline you selected.`);
                setExperiment(undefined);
                return;
            }

            if (version_reference.pipeline_version_id !== pipelineVersion!!.pipeline_version_id) {
                setError(`The last run in ${experiment.display_name} does not correspond to the pipeline version you selected.`);
                setExperiment(undefined);
                return;
            }

            setLastRun(run);
        }).catch((err) => {
            setError('Failed to load the last 5 runs of this experiment');
            logger.error(
                `Error: failed to retrieve last 5 runs for experiment: ${experiment.display_name}.`,
                err,
            );
        }).finally(() => {
            setFetchingLastRuns(false);
        });
    }, [experiment, fetchingLastRuns, namespace, pipeline, pipelineVersion])

    /* The templateString should be V2 otherwise display an error */
    useEffect(() => {
        if (!templateString) {
            return;
        }

        if (!isTemplateV2(templateString)) {
            setPipeline(undefined);
            setPipelineVersion(undefined);
            setError('You cannot create katib experiment with Kubeflow Pipeline V1.')
            return
        }
        setError(undefined);

        const spec = convertYamlToV2PipelineSpec(templateString);
        const params = spec.root?.inputDefinitions?.parameters;
        if (params) {
            setSpecParameters(params);
        } else {
            setSpecParameters({});
        }
    }, [templateString]);

    /* Manage the step displayed */
    const handleNext = () => {
        setActiveStep((prevActiveStep) => prevActiveStep + 1);
        setError(undefined);
    };
    const handleBack = () => {
        setActiveStep((prevActiveStep) => prevActiveStep - 1);
    };

    const handlePipelineChange = async (updatedPipeline: V2beta1Pipeline) => {
        setPipeline(updatedPipeline)
        if (updatedPipeline.pipeline_id) {
            const latestVersion = await getLatestVersion(updatedPipeline.pipeline_id);
            const searchString = urlParser.build({
                [QUERY_PARAMS.experimentId]: experiment?.experiment_id || '',
                [QUERY_PARAMS.pipelineId]: updatedPipeline.pipeline_id || '',
                [QUERY_PARAMS.pipelineVersionId]: latestVersion?.pipeline_version_id || '',
            });
            props.history.replace(searchString);
            setPipelineVersion(latestVersion);
        }
    }

    const handlePipelineVersionChange = async (updatedPipelineVersion: V2beta1PipelineVersion) => {
        setPipelineVersion(updatedPipelineVersion);

        if (pipeline?.pipeline_id && updatedPipelineVersion.pipeline_version_id) {
            const searchString = urlParser.build({
                [QUERY_PARAMS.experimentId]: experiment?.experiment_id || '',
                [QUERY_PARAMS.pipelineId]: pipeline.pipeline_id || '',
                [QUERY_PARAMS.pipelineVersionId]:
                updatedPipelineVersion.pipeline_version_id || '',
            });
            props.history.replace(searchString);
            setPipelineVersion(updatedPipelineVersion);
        }
    }

    const handleExperimentChange = async (updatedExperiment: V2beta1Experiment) => {
        setExperiment(updatedExperiment);

        if (updatedExperiment.experiment_id) {
            const searchString = urlParser.build({
                [QUERY_PARAMS.experimentId]: experiment?.experiment_id || '',
                [QUERY_PARAMS.pipelineId]: pipeline?.pipeline_id || '',
                [QUERY_PARAMS.pipelineVersionId]: pipelineVersion?.pipeline_version_id || '',
                [QUERY_PARAMS.experimentId]: updatedExperiment.experiment_id || '',
            });
            props.history.replace(searchString);
        }
    }

    const handleParameterChange = (paramConfig: ParameterConfig, action: Action) => {
        switch (action) {
            case Action.ADD:
                setParametersConfigs((prevState) => {
                    return [...prevState, paramConfig];
                });
                break;
            case Action.DELETE:
                setParametersConfigs((prevState) => {
                    return prevState.filter((config) => config.key !== paramConfig.key)
                });
                break;
            case Action.UPDATE:
                setParametersConfigs((prevState) => {
                    return [...prevState.filter((config) => config.key !== paramConfig.key), paramConfig]
                });
                setEditingParamConfig(undefined);
                break;
            case Action.REQUEST_UPDATE:
                setEditingParamConfig(paramConfig);
                break;
            case Action.CANCEL_UPDATE:
                setEditingParamConfig(undefined);
                break;
        }
    }

    const handleObjectiveChange = (objective: ObjectiveConfig, action: Action) => {
        console.log('handleObjectiveChange', objective, action);
        switch (action) {
            case Action.ADD:
                setObjectives((prevState) => {
                    // If we update the main objective, we need to ensure to remove other instance of it.
                    if (objective.goal !== undefined)
                        return [
                            ...prevState.filter((_obj) => _obj.metric.id !== objective.metric.id),
                            objective
                        ];

                    return [...prevState, objective];
                });
                break;
            case Action.DELETE:
                setObjectives((prevState) => {
                    return prevState.filter((_objective) => _objective.metric.id !== objective.metric.id);
                });
                break;
            case Action.UPDATE:
                setObjectives((prevState) => {
                    return [...prevState.filter((_objective) => _objective.metric.id !== objective.metric.id), objective]
                });
                break;
            case Action.REQUEST_UPDATE:
                break;
            case Action.CANCEL_UPDATE:
                break;
        }
    }

    const _can_next = (): boolean => {
        switch (activeStep) {
            case 0:
                return pipeline !== undefined && pipelineVersion !== undefined && experiment !== undefined;
            case 1:
                // Extract all required parameter for the pipeline
                const required = Object.entries(specParameters)
                    .filter((entry) => !entry[1].isOptional)
                    .map((entry) => entry[0]);

                // Improve perf by using a Set for checking inclusion
                const configKeys = new Set(parametersConfigs.map((config) => config.key));
                return required.every((element) => configKeys.has(element));
            case 2:
                return objectives.find((obj) => obj.goal !== undefined) !== undefined;
            default:
                return false;
        }
    }

    const _get_stepper = () => {
        switch (activeStep) {
            case 0:
                return (
                    <ExperimentDetails
                        {...props}
                        pipeline={pipeline}
                        pipelineVersion={pipelineVersion}
                        experiment={experiment}
                        handlePipelineChange={handlePipelineChange}
                        handlePipelineVersionChange={handlePipelineVersionChange}
                        handleExperimentChange={handleExperimentChange}
                    />
                )
            case 1:
                return (
                    <ParametersConfig
                        {...props}
                        specParameters={specParameters}
                        parametersConfigs={parametersConfigs}
                        handleParameterChange={handleParameterChange}
                        editingParamConfig={editingParamConfig}
                    />
                )
            case 2:
                return (
                    <Objectives
                        pipeline={pipeline!!}
                        pipelineVersion={pipelineVersion!!}
                        lastRun={lastRun}
                        mainObjective={objectives.find((obj) => obj.goal !== undefined)}
                        additionalObjectives={objectives.filter((obj) => obj.goal === undefined)}
                        handleObjectiveChange={handleObjectiveChange}
                    />
                )
            case 3:
                return (
                    <Advanced/>
                )
            default:
                throw new Error('_get_stepper got called with activeStep set to ' + activeStep);
        }
    }

    return (
        <div
            className={classes(commonCss.page, padding(20, 'lr'))}
            style={{paddingTop: '1.5rem', alignItems: 'center'}}
        >

            <Card style={{minWidth: '800px', width: 'fit-content'}}>
                <CardContent>
                    <Stepper activeStep={activeStep} style={{ padding: '24px 0px 0px' }}>
                        {steps.map((step, index) => (
                            <Step key={index}>
                                <StepLabel StepIconComponent={ColorlibStepIcon}>{step.label}</StepLabel>
                            </Step>
                        ))}
                    </Stepper>
                    {
                        error && <Banner message={error} mode='error' isLeftAlign={true} isRightAlign={true} />
                    }
                    <div key={activeStep}>{
                        _get_stepper()
                    }</div>
                    {/* Navigation buttons section */}
                    <div
                        className={classes(commonCss.flex, padding(20, 'tb'))}
                        style={{justifyContent: 'end'}}
                    >
                        {
                            (activeStep > 0) && (
                                <Button
                                    id='previousStepBtn'
                                    onClick={() => handleBack()}
                                    color='secondary'
                                >
                                    Previous
                                </Button>
                            )
                        }
                        <Button
                            id='nextStepBtn'
                            disabled={ !_can_next() }
                            onClick={() => handleNext()}
                            color='primary'
                            style={{marginRight: '0px'}}
                        >
                            Next
                        </Button>
                    </div>
                </CardContent>
            </Card>


        </div>
    )
}

export default NewKatibExperiment;
