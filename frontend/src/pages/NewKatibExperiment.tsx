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
import {V2beta1Run, V2beta1RunStorageState} from "../apisv2beta1/run";
import {logger} from "../lib/Utils";
import {useQuery} from "react-query";
import {
    getArtifactName,
    getArtifactsFromContext, getArtifactTypes,
    getEventsByExecutions, getExecutionDisplayName,
    getExecutionsFromContext,
    getKfpV2RunContext
} from "../mlmd/MlmdUtils";
import {filterRunArtifactsByType, getRunArtifacts, MlmdPackage} from "./CompareV2";
import {getScalarTableProps, MetricsType, RunArtifact} from "../lib/v2/CompareUtils";
import {ArtifactType, Value} from "../third_party/mlmd";
import {CompareTableProps} from "../components/CompareTable";
import * as jspb from "google-protobuf";

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

interface RangeConfig {
    min: number;
    max: number;
    step: number;
}

interface ObjectiveConfig {
    type: 'maximize' | 'minimize';
    metric: string
    goal: number | undefined
}

enum ParameterAction {
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
    handleParameterChange: (paramConfig: ParameterConfig, action: ParameterAction) => void;
    editingParamConfig: ParameterConfig | undefined;
}
type StepParametersConfigProps = PageProps & StepParametersConfigSpecificProps;

interface ObjectivesProps {
    pipeline: V2beta1Pipeline;
    pipelineVersion: V2beta1PipelineVersion;
    lastRuns: V2beta1Run[];
    objectives: ObjectiveConfig[];
}

function Objectives(props: ObjectivesProps) {

    // Scalar Metrics
    const [scalarMetricsTableData, setScalarMetricsTableData] = useState<
        CompareTableProps | undefined
    >(undefined);

    // Extract runIds
    const runIds: string[] = props.lastRuns
        .filter((run) => run.run_id !== undefined)
        .map((run) => run.run_id!!);

    // Retrieves MLMD states (executions and linked artifacts) from the MLMD store.
    const {
        data: mlmdPackages,
        isLoading: isLoadingMlmdPackages,
        isError: isErrorMlmdPackages,
        error: errorMlmdPackages,
    } = useQuery<MlmdPackage[], Error>(
        ['run_artifacts', { runIds }],
        () =>
            Promise.all(
                runIds.map(async runId => {
                    // TODO(zijianjoy): MLMD query is limited to 100 artifacts per run.
                    // https://github.com/google/ml-metadata/blob/5757f09d3b3ae0833078dbfd2d2d1a63208a9821/ml_metadata/proto/metadata_store.proto#L733-L737
                    const context = await getKfpV2RunContext(runId);
                    const executions = await getExecutionsFromContext(context);
                    const artifacts = await getArtifactsFromContext(context);
                    const events = await getEventsByExecutions(executions);
                    return {
                        executions,
                        artifacts,
                        events,
                    } as MlmdPackage;
                }),
            ),
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
        if(mlmdPackages === undefined || artifactTypes === undefined)
            return;

        const runArtifacts: RunArtifact[] = getRunArtifacts(props.lastRuns, mlmdPackages);
        const scalarMetricsArtifactData = filterRunArtifactsByType(
            runArtifacts,
            artifactTypes,
            MetricsType.SCALAR_METRICS,
        );

        for (const runArtifact of scalarMetricsArtifactData.runArtifacts) {
            const runName = runArtifact.run.display_name || '-';
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
                    }
                }
            }
        }

        setScalarMetricsTableData(
            getScalarTableProps(
                scalarMetricsArtifactData.runArtifacts,
                scalarMetricsArtifactData.artifactCount,
            ),
        );
    }, [props.lastRuns, mlmdPackages, artifactTypes]);

    if (props.lastRuns.length === 0)
        return (
            <Banner message={'Something went wrong, cannot found last runs for the pipeline.'} mode={'error'}/>
        )

    return (
        <div>
            <div className={commonCss.header}>Katib Experiment objective(s)</div>
            <div>
                {scalarMetricsTableData}
            </div>
        </div>
    )
}


interface ParametersTableProps {
    parameterConfigs: ParameterConfig[];
    handleParameterChange: (paramConfig: ParameterConfig, action: ParameterAction) => void;
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
                            <Button onClick={() => props.handleParameterChange(config, ParameterAction.REQUEST_UPDATE)}>
                                <EditIcon/>
                            </Button>
                            <Button
                                onClick={() => props.handleParameterChange(config, ParameterAction.DELETE)}>
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
            props.handleParameterChange(props.editingParamConfig, ParameterAction.CANCEL_UPDATE);
        }
    }, [paramSelectorOpen]);

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
    }, [parameterType]);

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
        if (feasibleSpace === undefined || parameterType === undefined) {
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
                                (props.editingParamConfig!== undefined)?ParameterAction.UPDATE:ParameterAction.ADD
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
    }, [props.pipeline, props.pipelineVersion])
    return (
        <div>
            <div className={commonCss.header}>Katib Experiment details</div>
            {/* Pipeline selection */}
            <div>You need to select a kubeflow pipeline that will be associate with the katib experiment</div>
            <PipelineSelector
                {...props}
                pipelineName={pipelineDisplayName}
                handlePipelineChange={props.handlePipelineChange}
            />

            {/* Pipeline version selection */}
            <PipelineVersionSelector
                {...props}
                pipeline={props.pipeline}
                pipelineVersionName={pipelineVersionDisplayName}
                handlePipelineVersionChange={props.handlePipelineVersionChange}
            />

            {/* Experiment selection */}
            <div>This katib experiment will be associated with the following experiment</div>
            <ExperimentSelector
                {...props}
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
    const [lastRuns, setLastRuns] = useState<V2beta1Run[]>([]);

    /* When the experiment change we fetch the last 5 runs in it */
    useEffect(() => {
        if(experiment === undefined || fetchingLastRuns)
            return;

        setFetchingLastRuns(true);
        Apis.runServiceApiV2.listRuns(
            namespace,
            experiment.experiment_id,
            undefined /* pageToken */,
            5 /* pageSize */,
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
            if (!response.total_size || response.total_size == 0) {
                setError('The experiment provided does not have any runs in it. You need at least one run of the successful pipeline specified in it.');
                return;
            }

            const filtered = response.runs?.filter((run) => {
                return run.pipeline_version_reference?.pipeline_id === pipeline!!.pipeline_id
                && run.pipeline_version_reference?.pipeline_version_id === pipelineVersion!!.pipeline_version_id
            });

            if (filtered === undefined || filtered?.length === 0) {
                setError(`The experiment ${experiment.display_name} does not have any history of the pipeline ${pipeline?.display_name} with version ${pipelineVersion?.display_name}.`)
                return;
            }

            setLastRuns(filtered);

        }).catch((err) => {
            setError('Failed to load the last 5 runs of this experiment');
            logger.error(
                `Error: failed to retrieve last 5 runs for experiment: ${experiment.display_name}.`,
                err,
            );
        }).finally(() => {
            setFetchingLastRuns(false);
        });
    }, [experiment])

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

    const handleParameterChange = (paramConfig: ParameterConfig, action: ParameterAction) => {
        switch (action) {
            case ParameterAction.ADD:
                setParametersConfigs((prevState) => {
                    return [...prevState, paramConfig];
                });
                break;
            case ParameterAction.DELETE:
                setParametersConfigs((prevState) => {
                    return prevState.filter((config) => config.key !== paramConfig.key)
                });
                break;
            case ParameterAction.UPDATE:
                setParametersConfigs((prevState) => {
                    return [...prevState.filter((config) => config.key !== paramConfig.key), paramConfig]
                });
                setEditingParamConfig(undefined);
                break;
            case ParameterAction.REQUEST_UPDATE:
                setEditingParamConfig(paramConfig);
                break;
            case ParameterAction.CANCEL_UPDATE:
                setEditingParamConfig(undefined);
                break;
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
                        lastRuns={lastRuns}
                    />
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
                        error && <Banner message={error} mode='error' isLeftAlign={true} />
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
                            disabled={ false
                                /*experiment === undefined
                                || pipeline === undefined
                                || pipelineVersion === undefined
                                || error === undefined*/
                            }
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
