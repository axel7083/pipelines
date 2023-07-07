import {PageProps} from "./Page";
import React, {useEffect, useState} from "react";
import {NamespaceContext} from "../lib/KubeflowClient";
import {classes} from "typestyle";
import {commonCss, padding} from "../Css";
import {QUERY_PARAMS} from "../components/Router";
import {
    getLatestVersion,
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
import {Apis, RunSortKeys} from "../lib/Apis";
import {V2beta1Filter, V2beta1PredicateOperation} from "../apisv2beta1/filter";
import {V2beta1Run} from "../apisv2beta1/run";
import {logger} from "../lib/Utils";
import {ExperimentDetails} from "src/components/katib/ExperimentDetails";
import {ParameterConfig, ParametersConfig} from "src/components/katib/ParametersConfig";
import {Action} from "src/components/katib/common";
import {ObjectiveConfig, Objectives} from "../components/katib/Objectives";
import {Algorithms} from "../components/katib/Algorithms";

const steps = [
    { label: 'Experiment Details'},
    { label: 'Parameters'},
    { label: 'Objectives'},
    { label: 'Algorithms'}
];


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
                    <Algorithms/>
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
