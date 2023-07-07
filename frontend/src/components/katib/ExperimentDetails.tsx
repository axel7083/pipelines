import {V2beta1Pipeline, V2beta1PipelineVersion} from "../../apisv2beta1/pipeline";
import {V2beta1Experiment} from "../../apisv2beta1/experiment";
import {PageProps} from "../../pages/Page";
import React, {useEffect, useState} from "react";
import {commonCss} from "../../Css";
import {ExperimentSelector, PipelineSelector, PipelineVersionSelector} from "../../pages/NewRunV2";

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

export { ExperimentDetails };
