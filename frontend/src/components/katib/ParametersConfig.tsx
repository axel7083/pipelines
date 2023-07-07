import LockIcon from "@material-ui/icons/Lock";
import TableHead from "@material-ui/core/TableHead";
import TableRow from "@material-ui/core/TableRow";
import TableCell from "@material-ui/core/TableCell";
import TableBody from "@material-ui/core/TableBody";
import {Button} from "@material-ui/core";
import EditIcon from "@material-ui/icons/Edit";
import DeleteIcon from "@material-ui/icons/Delete";
import {protoMap} from "../NewRunParametersV2";
import {ParameterType_ParameterTypeEnum} from "../../generated/pipeline_spec/pipeline_spec";
import React, {useEffect, useState} from "react";
import Banner from "../Banner";
import Input from "../../atoms/Input";
import MenuItem from "@material-ui/core/MenuItem";
import AddIcon from "@material-ui/icons/Add";
import Grid from "@material-ui/core/Grid";
import {commonCss} from "../../Css";
import Dialog from "@material-ui/core/Dialog";
import DialogTitle from "@material-ui/core/DialogTitle";
import DialogContent from "@material-ui/core/DialogContent";
import DialogActions from "@material-ui/core/DialogActions";
import {SpecParameters} from "../../pages/NewRunV2";
import {PageProps} from "../../pages/Page";
import {Action, katibCSS} from "./common";


interface RangeConfig {
    min: number;
    max: number;
    step: number;
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

interface ParametersTableProps {
    parameterConfigs: ParameterConfig[];
    handleParameterChange: (paramConfig: ParameterConfig, action: Action) => void;
}

function ParametersTable(props: ParametersTableProps) {
    const renderDomain = (parameterConfig: ParameterConfig) => {
        if (typeof parameterConfig.feasibleSpace === "string") {
            return (
                <div className={katibCSS.lockedDomain}>
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

interface StepParametersConfigSpecificProps {
    specParameters: SpecParameters
    parametersConfigs: ParameterConfig[];
    handleParameterChange: (paramConfig: ParameterConfig, action: Action) => void;
    editingParamConfig: ParameterConfig | undefined;
}
type StepParametersConfigProps = PageProps & StepParametersConfigSpecificProps;

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
                classes={{ paper: katibCSS.selectorDialog }}
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

export { ParametersConfig };
export type { ParameterConfig };
